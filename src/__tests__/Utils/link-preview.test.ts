import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { getUrlInfo } from '../../Utils/link-preview'

describe('getUrlInfo', () => {
	const originalFetch = globalThis.fetch
	const html =
		'<html><head><title>Preview title</title><meta name="description" content="Preview description"></head></html>'
	let requests: { url: string; init: RequestInit | undefined }[]
	let responses: Response[]

	beforeEach(() => {
		requests = []
		responses = []
		globalThis.fetch = (async (input, init) => {
			requests.push({ url: String(input), init })
			const response = responses.shift() ?? new Response(html, { headers: { 'Content-Type': 'text/html' } })
			Object.defineProperty(response, 'url', { value: String(input) })
			return response
		}) as typeof fetch
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('extracts metadata and adds HTTPS to a bare hostname', async () => {
		await expect(getUrlInfo('example.com')).resolves.toMatchObject({
			'canonical-url': 'https://example.com',
			'matched-text': 'example.com',
			title: 'Preview title',
			description: 'Preview description'
		})
		expect(requests[0]?.url).toBe('https://example.com')
	})

	it('forwards custom headers', async () => {
		await getUrlInfo('https://example.com', {
			thumbnailWidth: 192,
			fetchOpts: { timeout: 1000, headers: { 'User-Agent': 'Baileys preview test' } }
		})
		expect(requests[0]?.init?.headers).toMatchObject({ 'User-Agent': 'Baileys preview test' })
	})

	it('follows a redirect to the www hostname', async () => {
		responses.push(new Response(null, { status: 302, headers: { Location: 'https://www.example.com/page' } }))
		await expect(getUrlInfo('https://example.com')).resolves.toMatchObject({ title: 'Preview title' })
		expect(requests.map(request => request.url)).toEqual(['https://example.com', 'https://www.example.com/page'])
	})

	it('does not fetch a redirect to a different hostname', async () => {
		responses.push(new Response(null, { status: 302, headers: { Location: 'https://other.example.org/page' } }))
		await expect(getUrlInfo('https://example.com')).rejects.toThrow()
		expect(requests.map(request => request.url)).toEqual(['https://example.com'])
	})

	it('returns undefined when the page has no title', async () => {
		responses.push(new Response('<html><head></head></html>', { headers: { 'Content-Type': 'text/html' } }))
		await expect(getUrlInfo('https://example.com')).resolves.toBeUndefined()
	})

	it('does not fetch loopback addresses', async () => {
		await expect(getUrlInfo('http://127.0.0.1')).resolves.toBeUndefined()
		expect(requests).toHaveLength(0)
	})
})
