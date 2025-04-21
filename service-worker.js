// service-worker.js

// --- Configuration ---
// Model details (adjust if needed)
const GEMINI_MODEL = "gemini-1.5-flash-latest"; // Use a standard, available model like flash
const GEMINI_API_ENDPOINT_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;

// Keep track of ongoing fetch requests and their abort controllers, keyed by sidePanelInstanceId
const ongoingGenerations = new Map();


// --- Helper Functions ---

// Function to get the stored API key
async function getApiKey() {
    try {
        const result = await chrome.storage.local.get(['geminiApiKey']);
        return result.geminiApiKey;
    } catch (error) {
        console.error("Error getting API key from storage:", error);
        return null; // Return null or throw, depending on desired handling
    }
}

// Function to send messages reliably to the side panel (handles potential closure)
// Now requires instanceId to target the correct panel
function sendMessageToSidePanel(instanceId, message) {
    if (!instanceId) {
        console.error("sendMessageToSidePanel called without instanceId", message);
        return;
    }
    const messageToSend = { ...message, instanceId: instanceId }; // Ensure instanceId is included
    console.log(`Attempting to send message to side panel instance ${instanceId}:`, messageToSend.action);
    chrome.runtime.sendMessage(messageToSend).catch(error => {
        // Ignore errors caused by the side panel not being open
        if (error.message.includes("Receiving end does not exist") || error.message.includes("Could not establish connection") || error.message.includes("Port closed")) {
            console.log("Side panel not open or connection failed, message not sent:", message.action);
        } else {
            console.error("Error sending message to side panel:", error, message);
        }
    });
}


// Modified function to call the Gemini streaming API - uses instanceId
async function callGeminiStreamingApi(apiKey, prompt, instanceId, signal) {
    if (!apiKey) {
        sendMessageToSidePanel(instanceId, { action: "streamError", error: "API Key not set." });
        return; // Stop execution
    }

    // Use the streaming endpoint
    const url = `${GEMINI_API_ENDPOINT_BASE}:streamGenerateContent?key=${apiKey}&alt=sse`; // Use alt=sse for Server-Sent Events

    const requestBody = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],
        // Optional: Add safety settings, generation config if needed
        // "safetySettings": [...],
        // "generationConfig": { "temperature": 0.7, ... }
    };

    console.log("Calling Gemini Streaming API for instance:", instanceId);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: signal, // Pass the AbortSignal
        });

        if (!response.ok) {
            // Try to read error data even on stream errors
            const errorText = await response.text();
            let errorData = {};
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                console.warn("Could not parse error response as JSON:", errorText);
            }
            const errorMessage = errorData.error?.message || response.statusText || 'Unknown API error';
            console.error("Gemini API Error:", response.status, errorMessage, errorData);
            throw new Error(`API Error (${response.status}): ${errorMessage}`);
        }

        // Process the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let initialChunkSent = false; // Flag to send initial message only once

        while (true) {
             if (signal.aborted) {
                 console.log("Stream processing aborted by signal.");
                 throw new Error("Fetch aborted"); // Throw abort error to trigger finally block
             }

            const { done, value } = await reader.read();
            if (done) {
                console.log("Stream finished for instance:", instanceId);
                sendMessageToSidePanel(instanceId, { action: "streamEnd" });
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Process buffer line by line (SSE format: starts with "data: ")
            let lines = buffer.split('\n');
            buffer = lines.pop(); // Keep potential partial line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const jsonString = line.substring(6); // Remove "data: " prefix
                        if (!jsonString) continue; // Skip empty data lines

                        const data = JSON.parse(jsonString);

                         // Send initial message marker on first valid chunk
                         if (!initialChunkSent) {
                             sendMessageToSidePanel(instanceId, { action: "streamStart" });
                             initialChunkSent = true;
                         }

                        // Extract text chunk
                        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                            const chunk = data.candidates[0].content.parts[0].text;
                            sendMessageToSidePanel(instanceId, { action: "streamChunk", chunk: chunk });
                        } else if (data.promptFeedback) {
                             // Handle blocked prompts during stream
                             console.warn("Prompt feedback during stream for instance:", instanceId, data.promptFeedback);
                             const blockReason = data.promptFeedback.blockReason || "Unknown";
                             const safetyRatings = data.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ') || 'N/A';
                             const errorMsg = `[Content blocked due to: ${blockReason}. Safety Ratings: ${safetyRatings}]`;
                             sendMessageToSidePanel(instanceId, { action: "streamError", error: errorMsg });
                             return; // Stop processing this stream
                        } else {
                             // Log unexpected structure but continue processing stream if possible
                             console.warn("Unexpected data structure in stream chunk:", data);
                        }

                    } catch (e) {
                        console.warn("Could not parse JSON chunk:", line, e);
                        // Might be a partial chunk, wait for more data
                    }
                }
            }
        }

    } catch (error) {
        console.error("Error calling/processing Gemini stream for instance:", instanceId, error);
        if (error.name === 'AbortError' || signal.aborted) {
            console.log('Fetch aborted for instance:', instanceId);
            sendMessageToSidePanel(instanceId, { action: "streamAbort" });
        } else {
            sendMessageToSidePanel(instanceId, { action: "streamError", error: error.message || "An unknown error occurred during streaming." });
        }
    } finally {
         // Clean up the AbortController reference for this instance
         if (ongoingGenerations.has(instanceId)) {
             ongoingGenerations.delete(instanceId);
             console.log(`Cleaned up generation controller for instance ${instanceId}`);
         }
    }
}


// --- Event Listeners ---

// Set up the side panel on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting side panel behavior:", error));
  console.log("Side panel behavior set.");
});

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Use instanceId from the request if available (from side panel)
    const instanceId = request.instanceId;
    // Note: Content script messages won't have instanceId, handle appropriately if needed later

    console.log(`Service worker received message: ${request.action} (instanceId: ${instanceId})`);


    if (request.action === "saveApiKey") {
        chrome.storage.local.set({ geminiApiKey: request.apiKey }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving API key:", chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                console.log("API Key saved.");
                sendResponse({ success: true });
            }
        });
        return true; // Indicates response will be sent asynchronously
    }

    if (request.action === "getApiKey") {
        getApiKey().then(apiKey => {
            sendResponse({ apiKey: apiKey });
        }).catch(error => {
             console.error("Error getting API key:", error);
             sendResponse({ apiKey: null, error: error.message });
        });
        return true; // Indicates response will be sent asynchronously
    }

     // --- Stop Generation Handler ---
    if (request.action === "stopGeneration") {
        if (!instanceId) {
             console.warn("Stop request received without instanceId.");
             sendResponse({ success: false, error: "Missing instance identifier." });
             return false;
        }
        const controller = ongoingGenerations.get(instanceId);
        if (controller) {
            console.log(`Aborting generation for instance ${instanceId}`);
            controller.abort();
            // Cleanup happens in the finally block of callGeminiStreamingApi
            sendResponse({ success: true, message: "Abort signal sent." });
        } else {
             console.log(`No ongoing generation found to stop for instance ${instanceId}`);
             sendResponse({ success: false, message: "No active generation to stop." });
        }
        return true; // Async response possible
    }


    // --- Process Chat Handler (Modified for Streaming) ---
    if (request.action === "processChat") {
         if (!instanceId) {
             console.error("processChat request received without instanceId.");
             // Cannot send response reliably without instanceId
             return false;
         }

         // Check if a generation is already running for this instance
         if (ongoingGenerations.has(instanceId)) {
             console.warn(`Generation already in progress for instance ${instanceId}. Ignoring new request.`);
             // Send message back to side panel indicating busy state
             sendMessageToSidePanel(instanceId, { action: "streamError", error: "A request is already processing. Please wait or stop the current one." });
             return false; // Don't proceed
         }


        // Use an IIFE (Immediately Invoked Function Expression) to handle async logic cleanly
        (async () => {
            try {
                // 1. Get API Key
                const apiKey = await getApiKey();
                if (!apiKey) {
                    sendMessageToSidePanel(instanceId, { action: "streamError", error: "API Key not found. Please save it first." });
                    return;
                }

                // 2. Get DOM content - Need the *active content script's* tab
                let activeContentTabId;
                try {
                    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    activeContentTabId = activeTab?.id;
                    if (!activeContentTabId) {
                        throw new Error("Could not find active tab.");
                    }
                } catch (queryError) {
                     console.error("Error querying active tab:", queryError);
                     sendMessageToSidePanel(instanceId, { action: "streamError", error: "Could not find active tab to get content from." });
                     return;
                }


                let domResponse;
                try {
                    domResponse = await chrome.tabs.sendMessage(activeContentTabId, { action: "getDOM" });
                } catch (domError) {
                     // Handle errors like no content script injected or page not accessible
                     console.error("Error sending message to content script:", domError);
                     const errorMsg = domError.message.includes("Receiving end does not exist")
                        ? "Cannot connect to page content script. Try reloading the page."
                        : `Could not get page content: ${domError.message}.`;
                     sendMessageToSidePanel(instanceId, { action: "streamError", error: errorMsg });
                     return;
                }


                if (domResponse && domResponse.domContent !== undefined) {
                    const domContent = domResponse.domContent; // This is now plain text from Readability
                    const userMessage = request.message;
                    // No JSON.stringify needed

                    // 3. Construct Prompt
                    const fullPrompt = `You are a helpful assistant interacting with a user viewing a web page.
Analyze the following extracted text content from the user's current web page and answer their query. Respond using Markdown format.

Web Page Content (Extracted Text):
--- START CONTENT ---
${domContent}
--- END CONTENT ---

User Query: ${userMessage}`;

                    // 4. Call Gemini Streaming API
                    const controller = new AbortController();
                    ongoingGenerations.set(instanceId, controller); // Use instanceId as key
                    console.log(`Stored generation controller for instance ${instanceId}`);

                    // Start streaming but don't await it here
                    callGeminiStreamingApi(apiKey, fullPrompt, instanceId, controller.signal); // Pass instanceId

                    // No sendResponse needed here; side panel waits for stream messages

                } else {
                    // Content script might not have responded correctly or sent error
                    const errorMsg = domResponse?.error || "Did not receive valid content from the page.";
                    console.error("Invalid DOM response:", domResponse);
                    sendMessageToSidePanel(instanceId, { action: "streamError", error: errorMsg });
                }

            } catch (error) {
                // Catch errors from getApiKey or other unexpected issues
                console.error("Error in processChat async block:", error);
                sendMessageToSidePanel(instanceId, { action: "streamError", error: `An internal error occurred: ${error.message}` });
            }
        })(); // End IIFE

        return true; // Indicate that async operations are happening (even though we don't use sendResponse here)
    }

    // Default: Return false if the message isn't handled or doesn't need an async response
    // console.log(`Action ${request.action} not handled or synchronous.`);
    // return false; // Removed getSidePanelTabId handler


    // If no action matched and requires async response, return false or undefined.
    // Returning true unnecessarily can cause issues if sendResponse is never called.

}); // End of onMessage listener

console.log("Service worker started.");
