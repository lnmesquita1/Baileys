import { Boom } from '@hapi/boom'
import pino from 'pino'
import { proto } from '../../../WAProto/index.js'
import type { SignalRepositoryWithLIDStore } from '../../Types/Signal'
import { decodeMessageNode, decryptMessageNode } from '../../Utils/decode-wa-message'
import type { BinaryNode } from '../../WABinary'

const ME_ID = '5511999999999@s.whatsapp.net'
const ME_LID = '111111111111111@lid'
const PEER_ID = '5511888888888@s.whatsapp.net'
const GROUP_ID = '120363000000000000@g.us'

const message = (attrs: Record<string, string>): BinaryNode => ({
	tag: 'message',
	attrs: { t: '1700000000', ...attrs },
	content: []
})

const captureThrow = (fn: () => unknown): unknown => {
	try {
		fn()
	} catch (err) {
		return err
	}

	throw new Error('expected function to throw')
}

describe('decodeMessageNode', () => {
	describe('validation', () => {
		it('throws Boom when stanza has no id attribute', () => {
			const stanza = message({ from: PEER_ID })
			const err = captureThrow(() => decodeMessageNode(stanza, ME_ID, ME_LID))
			expect(err).toBeInstanceOf(Boom)
			expect((err as Error).message).toMatch(/missing id/)
		})

		it('throws Boom when stanza has no from attribute', () => {
			const stanza = message({ id: 'MSG_1' })
			const err = captureThrow(() => decodeMessageNode(stanza, ME_ID, ME_LID))
			expect(err).toBeInstanceOf(Boom)
			expect((err as Error).message).toMatch(/missing from/)
		})

		it('throws Boom for an unknown jid type', () => {
			const stanza = message({ id: 'MSG_1', from: 'unknown@server' })
			expect(() => decodeMessageNode(stanza, ME_ID, ME_LID)).toThrow(/Unknown message type/)
		})

		it('throws Boom for group message without participant', () => {
			const stanza = message({ id: 'MSG_1', from: GROUP_ID })
			expect(() => decodeMessageNode(stanza, ME_ID, ME_LID)).toThrow(/No participant/)
		})
	})

	describe('happy paths', () => {
		it('decodes a 1:1 incoming chat message', () => {
			const stanza = message({ id: 'MSG_1', from: PEER_ID })
			const result = decodeMessageNode(stanza, ME_ID, ME_LID)

			expect(result.fullMessage.key.id).toBe('MSG_1')
			expect(result.fullMessage.key.remoteJid).toBe(PEER_ID)
			expect(result.fullMessage.key.fromMe).toBeFalsy()
			expect(result.author).toBe(PEER_ID)
		})

		it('decodes an outgoing chat message (recipient set, from = me)', () => {
			const stanza = message({ id: 'MSG_2', from: ME_ID, recipient: PEER_ID })
			const result = decodeMessageNode(stanza, ME_ID, ME_LID)

			expect(result.fullMessage.key.fromMe).toBe(true)
			expect(result.fullMessage.key.remoteJid).toBe(PEER_ID)
		})

		it('rejects a recipient-tagged message that is not from me', () => {
			const stanza = message({ id: 'MSG_3', from: PEER_ID, recipient: ME_ID })
			expect(() => decodeMessageNode(stanza, ME_ID, ME_LID)).toThrow(/not from me/)
		})

		it('decodes a group message', () => {
			const stanza = message({ id: 'MSG_G', from: GROUP_ID, participant: PEER_ID })
			const result = decodeMessageNode(stanza, ME_ID, ME_LID)

			expect(result.fullMessage.key.remoteJid).toBe(GROUP_ID)
			expect(result.fullMessage.key.participant).toBe(PEER_ID)
			expect(result.author).toBe(PEER_ID)
		})
	})
})

describe('decryptMessageNode deviceSentMessage context', () => {
	const decrypt = async (decodedMessage: proto.IMessage) => {
		const stanza = message({ id: 'DEVICE_MSG', from: ME_ID, recipient: PEER_ID })
		stanza.content = [{ tag: 'plaintext', attrs: {}, content: proto.Message.encode(decodedMessage).finish() }]
		const repository = {
			lidMapping: { getLIDForPN: async () => undefined }
		} as unknown as SignalRepositoryWithLIDStore
		const result = decryptMessageNode(stanza, ME_ID, ME_LID, repository, pino({ level: 'silent' }))
		await result.decrypt()
		return result.fullMessage.message
	}

	it('preserves the outer message secret when extracting a device-sent message', async () => {
		const messageSecret = Buffer.alloc(32, 7)
		const result = await decrypt({
			deviceSentMessage: { destinationJid: PEER_ID, message: { conversation: 'Hello' } },
			messageContextInfo: { messageSecret, deviceListMetadataVersion: 2 }
		})

		expect(result?.conversation).toBe('Hello')
		expect(result?.deviceSentMessage).toBeNull()
		expect(result?.messageContextInfo?.messageSecret).toEqual(messageSecret)
		expect(result?.messageContextInfo?.deviceListMetadataVersion).toBe(2)
	})

	it('preserves the outer secret when the inner context contains other metadata', async () => {
		const messageSecret = Buffer.alloc(32, 7)
		const result = await decrypt({
			deviceSentMessage: {
				message: { conversation: 'Hello', messageContextInfo: { deviceListMetadataVersion: 3 } }
			},
			messageContextInfo: { messageSecret, deviceListMetadataVersion: 2 }
		})

		expect(result?.messageContextInfo?.messageSecret).toEqual(messageSecret)
		expect(result?.messageContextInfo?.deviceListMetadataVersion).toBe(3)
	})

	it('gives the inner message secret precedence over the envelope secret', async () => {
		const innerSecret = Buffer.alloc(32, 9)
		const result = await decrypt({
			deviceSentMessage: {
				message: { conversation: 'Hello', messageContextInfo: { messageSecret: innerSecret } }
			},
			messageContextInfo: { messageSecret: Buffer.alloc(32, 7) }
		})

		expect(result?.messageContextInfo?.messageSecret).toEqual(innerSecret)
	})

	it('extracts a device-sent message without adding a missing context', async () => {
		const result = await decrypt({ deviceSentMessage: { message: { conversation: 'Hello' } } })

		expect(result?.conversation).toBe('Hello')
		expect(result?.messageContextInfo).toBeNull()
	})

	it('leaves the secret intact for messages without a device-sent envelope', async () => {
		const messageSecret = Buffer.alloc(32, 7)
		const result = await decrypt({ conversation: 'Hello', messageContextInfo: { messageSecret } })

		expect(result?.conversation).toBe('Hello')
		expect(result?.messageContextInfo?.messageSecret).toEqual(messageSecret)
	})
})
