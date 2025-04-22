
const GEMINI_MODEL = "gemini-2.5-pro-preview-03-25";
const GEMINI_API_ENDPOINT_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;

const ongoingGenerations = new Map();

async function getApiKey() {
    try {
        const result = await chrome.storage.local.get(['geminiApiKey']);
        return result.geminiApiKey;
    } catch (error) {

        return null;
    }
}


function sendMessageToSidePanel(instanceId, message) {
    if (!instanceId) {

        return;
    }
    const messageToSend = { ...message, instanceId: instanceId };

    chrome.runtime.sendMessage(messageToSend);
}



async function callGeminiStreamingApi(apiKey, prompt, instanceId, signal) {
    if (!apiKey) {
        sendMessageToSidePanel(instanceId, { action: "streamError", error: "API Key not set." });
        return;
    }


    const url = `${GEMINI_API_ENDPOINT_BASE}:streamGenerateContent?key=${apiKey}&alt=sse`;

    const requestBody = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }],

    };


    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData = {};
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {

            }
            const errorMessage = errorData.error?.message || response.statusText || 'Unknown API error';

            throw new Error(`API Error (${response.status}): ${errorMessage}`);
        }


        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let initialChunkSent = false;

        while (true) {
            if (signal.aborted) {

                throw new Error("Fetch aborted");
            }

            const { done, value } = await reader.read();
            if (done) {

                sendMessageToSidePanel(instanceId, { action: "streamEnd" });
                break;
            }

            buffer += decoder.decode(value, { stream: true });


            let lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {

                    const jsonString = line.substring(6);
                    if (!jsonString) continue;

                    const data = JSON.parse(jsonString);


                    if (!initialChunkSent) {
                        sendMessageToSidePanel(instanceId, { action: "streamStart" });
                        initialChunkSent = true;
                    }


                    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                        const chunk = data.candidates[0].content.parts[0].text;
                        sendMessageToSidePanel(instanceId, { action: "streamChunk", chunk: chunk });
                    } else if (data.promptFeedback) {


                        const blockReason = data.promptFeedback.blockReason || "Unknown";
                        const safetyRatings = data.promptFeedback.safetyRatings?.map(r => `${r.category}: ${r.probability}`).join(', ') || 'N/A';
                        const errorMsg = `[Content blocked due to: ${blockReason}. Safety Ratings: ${safetyRatings}]`;
                        sendMessageToSidePanel(instanceId, { action: "streamError", error: errorMsg });
                        return;
                    }
                }
            }
        }

    } catch (error) {

        if (error.name === 'AbortError' || signal.aborted) {

            sendMessageToSidePanel(instanceId, { action: "streamAbort" });
        } else {
            sendMessageToSidePanel(instanceId, { action: "streamError", error: error.message || "An unknown error occurred during streaming." });
        }
    } finally {

        if (ongoingGenerations.has(instanceId)) {
            ongoingGenerations.delete(instanceId);

        }
    }
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => { });
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    const instanceId = request.instanceId;

    if (request.action === "saveApiKey") {
        chrome.storage.local.set({ geminiApiKey: request.apiKey }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    if (request.action === "getApiKey") {
        getApiKey().then(apiKey => {
            sendResponse({ apiKey: apiKey });
        }).catch(error => {

            sendResponse({ apiKey: null, error: error.message });
        });
        return true;
    }

    if (request.action === "stopGeneration") {
        if (!instanceId) {
            sendResponse({ success: false, error: "Missing instance identifier." });
            return false;
        }
        const controller = ongoingGenerations.get(instanceId);
        if (controller) {
            controller.abort();
            sendResponse({ success: true, message: "Abort signal sent." });
        } else {
            sendResponse({ success: false, message: "No active generation to stop." });
        }

        return false;
    }

    if (request.action === "processChat") {
        if (!instanceId) {
            return false;
        }

        if (ongoingGenerations.has(instanceId)) {
            sendMessageToSidePanel(instanceId, { action: "streamError", error: "A request is already processing. Please wait or stop the current one." });
            return false;
        }

        (async () => {
            try {
                const apiKey = await getApiKey();
                if (!apiKey) {
                    sendMessageToSidePanel(instanceId, { action: "streamError", error: "API Key not found. Please save it first." });
                    return;
                }

                let activeContentTabId;
                try {
                    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    activeContentTabId = activeTab?.id;
                    if (!activeContentTabId) {
                        throw new Error("Could not find active tab.");
                    }
                } catch (queryError) {
                    sendMessageToSidePanel(instanceId, { action: "streamError", error: "Could not find active tab to get content from." });
                    return;
                }

                let domResponse;
                try {
                    domResponse = await chrome.tabs.sendMessage(activeContentTabId, { action: "getDOM" });
                } catch (domError) {

                    const errorMsg = domError.message.includes("Receiving end does not exist")
                        ? "Cannot connect to page content script. Try reloading the page."
                        : `Could not get page content: ${domError.message}.`;
                    sendMessageToSidePanel(instanceId, { action: "streamError", error: errorMsg });
                    return;
                }

                if (domResponse && domResponse.domContent !== undefined) {
                    const domContent = domResponse.domContent;
                    const userMessage = request.message;
                    const fullPrompt = `
--- START DOC ---
${domContent}
--- END DOC ---

${userMessage}`;

                    const controller = new AbortController();
                    ongoingGenerations.set(instanceId, controller);
                    callGeminiStreamingApi(apiKey, fullPrompt, instanceId, controller.signal);
                } else {
                    const errorMsg = domResponse?.error || "Did not receive valid content from the page.";
                    sendMessageToSidePanel(instanceId, { action: "streamError", error: errorMsg });
                }
            } catch (error) {
                sendMessageToSidePanel(instanceId, { action: "streamError", error: `An internal error occurred: ${error.message}` });
            }
        })();

        return true;
    }
});
