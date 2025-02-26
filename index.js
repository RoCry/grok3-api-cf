/**
 * Grok3 API Cloudflare Worker
 * OpenAI-compatible API for Grok3
 */

class GrokClient {
  constructor(cookies) {
    this.baseUrl = "https://grok.com/rest/app-chat/conversations/new";
    this.cookies = cookies;
    this.headers = {
      "accept": "*/*",
      "accept-language": "en-GB,en;q=0.9",
      "content-type": "application/json",
      "origin": "https://grok.com",
      "priority": "u=1, i",
      "referer": "https://grok.com/",
      "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Brave";v="126"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "cookie": cookies
    };
  }

  _preparePayload(message) {
    return {
      "temporary": false,
      "modelName": "grok-3",
      "message": message,
      "fileAttachments": [],
      "imageAttachments": [],
      "disableSearch": false,
      "enableImageGeneration": true,
      "returnImageBytes": false,
      "returnRawGrokInXaiRequest": false,
      "enableImageStreaming": true,
      "imageGenerationCount": 2,
      "forceConcise": false,
      "toolOverrides": {},
      "enableSideBySide": true,
      "isPreset": false,
      "sendFinalMetadata": true,
      "customInstructions": "",
      "deepsearchPreset": "",
      "isReasoning": false
    };
  }

  async sendMessage(message, stream = false) {
    const payload = this._preparePayload(message);
    
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
    }

    if (stream) {
      return response.body;
    } else {
      let fullResponse = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const jsonData = JSON.parse(line);
            const result = jsonData.result || {};
            const responseData = result.response || {};
            
            if (responseData.modelResponse) {
              return responseData.modelResponse.message;
            }
            
            const token = responseData.token || "";
            if (token) {
              fullResponse += token;
            }
          } catch (e) {
            // Skip JSON parse errors
          }
        }
      }
      
      return fullResponse.trim();
    }
  }
}

// Helper to create OpenAI compatible streaming responses
function createOpenAIStreamingResponse(readableStream, requestId) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  return new ReadableStream({
    async start(controller) {
      const reader = readableStream.getReader();
      let fullContent = "";
      let completionId = `chatcmpl-${crypto.randomUUID()}`;
      
      // Send the start of the stream
      const startChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "grok-3",
        choices: [{
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null
        }]
      };
      
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(startChunk)}\n\n`));

      // Buffer to accumulate incomplete JSON data
      let buffer = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Process complete JSON lines from buffer
          let newBuffer = '';
          const lines = buffer.split('\n');
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // If this is not the last line, it must be complete
            // Or if it's the last line and ends with a newline
            const isCompleteLine = i < lines.length - 1 || chunk.endsWith('\n');
            
            if (isCompleteLine) {
              try {
                const jsonData = JSON.parse(line);
                const result = jsonData.result || {};
                const responseData = result.response || {};
                
                // Handle both token and modelResponse
                if (responseData.modelResponse) {
                  // This is a final message, but we'll still process it as a token
                  // rather than returning early, which could miss content
                  const finalMessage = responseData.modelResponse.message || "";
                  
                  // Only send if there's content
                  if (finalMessage && finalMessage !== fullContent) {
                    // If we had partial content already, just send the remainder
                    const remainingContent = finalMessage.slice(fullContent.length);
                    
                    if (remainingContent) {
                      fullContent = finalMessage;
                      const chunk = {
                        id: completionId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: "grok-3",
                        choices: [{
                          index: 0,
                          delta: { content: remainingContent },
                          finish_reason: null
                        }]
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                    }
                  }
                }
                
                const token = responseData.token || "";
                if (token) {
                  fullContent += token;
                  const chunk = {
                    id: completionId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: "grok-3",
                    choices: [{
                      index: 0,
                      delta: { content: token },
                      finish_reason: null
                    }]
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
              } catch (e) {
                // Incomplete or invalid JSON, skip this line
              }
            } else {
              // This is an incomplete line, add it back to the buffer
              newBuffer = line;
            }
          }
          
          buffer = newBuffer; // Update buffer with any incomplete data
        }
        
        // Send a final chunk with stop reason when we're done
        const finalChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "grok-3",
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop"
          }]
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
        
        // End of stream marker
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    }
  });
}

// Helper to create OpenAI compatible full responses
function createOpenAIFullResponse(content) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "grok-3",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: -1,
      completion_tokens: -1,
      total_tokens: -1
    }
  };
}

// Main request handler
async function handleRequest(request, env) {
  // Check if it's a POST request to /v1/chat/completions
  const url = new URL(request.url);
  if (url.pathname !== "/v1/chat/completions") {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Check authentication
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized: Bearer token required", { status: 401 });
  }

  const token = authHeader.split(" ")[1];
  if (!env.AUTH_TOKEN || token !== env.AUTH_TOKEN) {
    return new Response("Unauthorized: Invalid token", { status: 401 });
  }

  // Check for required environment variables
  if (!env.GROK3_COOKIE) {
    return new Response("Server Error: GROK3_COOKIE environment variable is not set", { status: 500 });
  }

  try {
    // Parse the request body
    const body = await request.json();
    
    // Extract the messages
    const messages = body.messages || [];
    if (!messages.length) {
      return new Response("Bad Request: No messages provided", { status: 400 });
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === "user").pop();
    if (!lastUserMessage) {
      return new Response("Bad Request: No user message found", { status: 400 });
    }

    // Initialize the Grok client
    const grokClient = new GrokClient(env.GROK3_COOKIE);
    
    // Determine if streaming is requested
    const stream = body.stream === true;
    
    if (stream) {
      // Handle streaming response
      const grokStream = await grokClient.sendMessage(lastUserMessage.content, true);
      const openAIStream = createOpenAIStreamingResponse(grokStream, crypto.randomUUID());
      
      return new Response(openAIStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    } else {
      // Handle normal response
      const response = await grokClient.sendMessage(lastUserMessage.content);
      const openAIResponse = createOpenAIFullResponse(response);
      
      return new Response(JSON.stringify(openAIResponse), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}

// Export the fetch handler for Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};
