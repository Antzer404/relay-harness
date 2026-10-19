import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockAnthropicOptions {
  workspaceDir: string
}

export interface CapturedRequest {
  url: string
  body: any
}

export interface MockAnthropicServer {
  url: string
  requests: CapturedRequest[]
  close: () => Promise<void>
}

type Sse = (event: string, data: unknown) => void

function streamHeaders(): http.OutgoingHttpHeaders {
  return {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'request-id': `req_mock_${Math.random().toString(36).slice(2, 10)}`
  }
}

function startMessage(sse: Sse, model: string, inputTokens: number, cacheRead = 0): void {
  sse('message_start', {
    type: 'message_start',
    message: {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: cacheRead
      }
    }
  })
}

function thinkingBlock(sse: Sse, index: number, text: string): void {
  sse('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' }
  })
  sse('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking: text }
  })
  sse('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'signature_delta', signature: 'mock-signature-0.3.303' }
  })
  sse('content_block_stop', { type: 'content_block_stop', index })
}

function textBlock(sse: Sse, index: number, text: string): void {
  sse('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' }
  })
  sse('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text }
  })
  sse('content_block_stop', { type: 'content_block_stop', index })
}

function toolBlock(
  sse: Sse,
  index: number,
  id: string,
  name: string,
  input: unknown
): void {
  sse('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {} }
  })
  sse('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) }
  })
  sse('content_block_stop', { type: 'content_block_stop', index })
}

export async function startMockAnthropic(
  options: MockAnthropicOptions
): Promise<MockAnthropicServer> {
  const requests: CapturedRequest[] = []
  let messageCalls = 0

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"not found"}')
      return
    }

    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    requests.push({ url: req.url, body })

    if (req.url.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ input_tokens: 64 }))
      return
    }

    const model = String(body.model ?? 'deepseek-flash')
    messageCalls += 1
    const turn = messageCalls
    res.writeHead(200, streamHeaders())
    const sse: Sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    if (turn === 1) {
      startMessage(sse, model, 1200)
      thinkingBlock(sse, 0, 'The user asks for a file. I will inspect the workspace and write hello.txt.')
      textBlock(sse, 1, 'I will create hello.txt in the workspace.')
      toolBlock(sse, 2, 'toolu_mock_1', 'Write', {
        file_path: `${options.workspaceDir}/hello.txt`,
        content: 'relay mock file\n'
      })
      sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 42 }
      })
    } else {
      startMessage(sse, model, 1500, 900)
      textBlock(sse, 0, '已写入 hello.txt（mock）。')
      sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 18 }
      })
    }

    sse('message_stop', { type: 'message_stop' })
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}
