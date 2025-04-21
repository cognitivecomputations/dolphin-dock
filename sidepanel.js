// sidepanel.js
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyButton = document.getElementById('saveApiKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const apiKeyDetails = document.getElementById('apiKeyDetails');
const toggleApiKeyVisibilityButton = document.getElementById('toggleApiKeyVisibility');
const apiKeyToggleIndicator = document.getElementById('apiKeyToggleIndicator');
const chatbox = document.getElementById('chatbox');
const messageInput = document.getElementById('messageInput');
const sendMessageButton = document.getElementById('sendMessage');
const stopGeneratingButton = document.getElementById('stopGenerating');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorDisplay = document.getElementById('errorDisplay');

let isStreaming = false;
let currentGeminiMessageDiv = null;
let currentOutputText = '';
const sidePanelInstanceId = crypto.randomUUID(); // Unique ID for this panel instance
console.log("Side Panel Instance ID:", sidePanelInstanceId);

// --- Initialization ---

// Function to toggle API key section visibility and rotate icon
function toggleApiKeySection(show) {
    if (show) {
        apiKeyDetails.classList.remove('hidden');
        apiKeyToggleIndicator.classList.add('rotate-180');
    } else {
        apiKeyDetails.classList.add('hidden');
        apiKeyToggleIndicator.classList.remove('rotate-180');
    }
}

// Load saved API key on startup
document.addEventListener('DOMContentLoaded', () => {
    // Enable input by default now
    messageInput.disabled = false;
    sendMessageButton.disabled = false;
    messageInput.focus();

    loadingIndicator.style.display = 'block';
    chrome.runtime.sendMessage({ action: "getApiKey" }, (response) => {
        loadingIndicator.style.display = 'none';
        if (response && response.apiKey) {
            apiKeyInput.value = response.apiKey;
            apiKeyStatus.textContent = 'API Key loaded.';
            apiKeyStatus.style.color = 'green';
            toggleApiKeySection(false);
        } else {
            apiKeyStatus.textContent = 'API Key not set.';
            apiKeyStatus.style.color = 'orange';
            toggleApiKeySection(true);
            if(response?.error) {
                 console.error("Error loading API key:", response.error);
                 displayError(`Error loading API key: ${response.error}`);
            }
        }
    });
    // Ensure correct initial UI state for buttons
    updateStreamingUI(false);
});

// Function to add messages to the chatbox (modified for streaming)
function addMessage(text, sender, isComplete = true) {
    // ... (Keep the existing addMessage logic - no changes needed here) ...
    if (sender === 'gemini' && !isComplete && currentGeminiMessageDiv) {
        // Append chunk to existing message div
        currentOutputText += text;
        // Basic text update for now, consider Markdown parsing later
        currentGeminiMessageDiv.querySelector('.message-content').textContent = currentOutputText;

    } else {
        // Create new message div
        const messageDiv = document.createElement('div');
        const contentSpan = document.createElement('span'); // Span to hold text content
        contentSpan.classList.add('message-content');
        contentSpan.textContent = text; // Set initial text

        if (sender === 'user') {
            messageDiv.classList.add('bg-gray-100', 'p-3', 'rounded-xl', 'max-w-[85%]', 'self-end', 'break-words', 'text-foreground');
            messageDiv.appendChild(contentSpan); // Add content span
        } else { // Gemini message (start or complete)
            messageDiv.classList.add('bg-transparent', 'p-3', 'rounded-xl', 'max-w-[85%]', 'self-start', 'relative', 'group', 'break-words', 'text-foreground');
            messageDiv.appendChild(contentSpan); // Add content span

            if (isComplete) {
                addCopyButton(messageDiv, text); // Add copy button only when complete
                currentGeminiMessageDiv = null; // Reset current message div
                currentOutputText = '';
            } else {
                // This is the start of a streaming message
                currentGeminiMessageDiv = messageDiv; // Store reference
                currentOutputText = text; // Store initial text
                // Don't add copy button yet
            }
        }
        chatbox.appendChild(messageDiv);
    }

    // Scroll to the bottom
    chatbox.scrollTop = chatbox.scrollHeight;
    return currentGeminiMessageDiv; // Return reference if streaming
}

// Helper to add copy button
function addCopyButton(messageDiv, textToCopy) {
    // ... (Keep the existing addCopyButton logic - no changes needed here) ...
     if (!messageDiv) return;
     // Check if button already exists
     if (messageDiv.querySelector('.copy-button')) return;

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.classList.add(
        'copy-button', // Add class for potential selection
        'absolute', 'bottom-1', 'right-1', 'bg-muted', 'text-muted-foreground',
        'text-xs', 'px-1.5', 'py-0.5', 'rounded-md', 'opacity-0', 'group-hover:opacity-100',
        'transition-opacity', 'focus:outline-none', 'focus:ring-1', 'focus:ring-ring'
    );
    copyButton.onclick = () => {
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                copyButton.textContent = 'Copied!';
                setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy text: ', err);
                copyButton.textContent = 'Error';
                 setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
            });
    };
    messageDiv.appendChild(copyButton);
}


// Function to display errors
function displayError(message) {
     errorDisplay.textContent = message;
     console.error("Error displayed to user:", message);
}

// Function to clear errors
function clearError() {
    errorDisplay.textContent = '';
}

// Update UI based on streaming state
function updateStreamingUI(streaming) {
    isStreaming = streaming;
    if (streaming) {
        sendMessageButton.classList.add('hidden');
        stopGeneratingButton.classList.remove('hidden');
        messageInput.disabled = true;
    } else {
        sendMessageButton.classList.remove('hidden');
        stopGeneratingButton.classList.add('hidden');
        messageInput.disabled = false; // Re-enable
        messageInput.focus(); // Restore focus when streaming ends

        // Ensure copy button is added if streaming finished successfully
        if (currentGeminiMessageDiv && currentOutputText) {
             addCopyButton(currentGeminiMessageDiv, currentOutputText);
        }
        currentGeminiMessageDiv = null; // Reset reference
        currentOutputText = '';
    }
}


// Function to handle sending a message
function handleSendMessage() {
    const messageText = messageInput.value.trim();
    if (!messageText || isStreaming) return;

    clearError();
    addMessage(messageText, 'user');
    messageInput.value = '';
    messageInput.style.height = 'auto'; // Reset height
    updateStreamingUI(true); // Show stop button, disable input

    // Send message to service worker to start processing
    chrome.runtime.sendMessage(
        {
            action: "processChat",
            message: messageText,
            instanceId: sidePanelInstanceId // Include the unique instance ID
        },
        (response) => {
            // Handle potential immediate errors
            if (chrome.runtime.lastError) {
                 console.error("Error sending 'processChat' message:", chrome.runtime.lastError);
                 displayError(`Extension communication error: ${chrome.runtime.lastError.message}`);
                 updateStreamingUI(false);
            } else if (response && !response.success && response.error) {
                 console.error("Immediate error response from service worker:", response.error);
                 displayError(response.error);
                 updateStreamingUI(false);
            }
        }
    );
}


// --- Event Listeners ---

// Toggle API Key section visibility
toggleApiKeyVisibilityButton.addEventListener('click', () => {
    const isHidden = apiKeyDetails.classList.contains('hidden');
    toggleApiKeySection(isHidden);
});

// Save API Key
saveApiKeyButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        apiKeyStatus.textContent = 'Please enter an API key.';
        apiKeyStatus.style.color = 'red';
        return;
    }
    chrome.runtime.sendMessage({ action: "saveApiKey", apiKey: apiKey }, (response) => {
        if (response && response.success) {
            apiKeyStatus.textContent = 'API Key saved successfully!';
            apiKeyStatus.style.color = 'green';
            clearError();
            toggleApiKeySection(false);
        } else {
             const errorMsg = response?.error || 'Failed to save API Key.';
             apiKeyStatus.textContent = `Error: ${errorMsg}`;
             apiKeyStatus.style.color = 'red';
             console.error("Failed to save API Key:", response);
             displayError(`Failed to save API Key: ${errorMsg}`);
             toggleApiKeySection(true);
        }
    });
});

// Send message on button click
sendMessageButton.addEventListener('click', handleSendMessage);

// Send message on Enter key press in textarea
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
    }
});

// Stop Generation button click
stopGeneratingButton.addEventListener('click', () => {
    if (!isStreaming) return;
    console.log("Stop Generating button clicked.");
    stopGeneratingButton.disabled = true;
    stopGeneratingButton.textContent = 'Stopping...';

    chrome.runtime.sendMessage(
        {
            action: "stopGeneration",
            instanceId: sidePanelInstanceId // Include the unique instance ID
        },
        (response) => {
         stopGeneratingButton.disabled = false;
         stopGeneratingButton.innerHTML = `
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 mr-1.5">
                <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8 7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H8Z" clip-rule="evenodd" />
             </svg>
            Stop Generating`;

         if (chrome.runtime.lastError) {
             console.error("Error sending 'stopGeneration' message:", chrome.runtime.lastError);
             displayError(`Error stopping generation: ${chrome.runtime.lastError.message}`);
         } else if (response && !response.success) {
             console.warn("Stop generation request failed:", response.message);
         } else {
             console.log("Stop request acknowledged by service worker.");
         }
    });
});


// --- Listener for messages from Service Worker ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // IMPORTANT: Check if the message is intended for this specific side panel instance
    if (request.instanceId && request.instanceId !== sidePanelInstanceId) {
        // console.log("Ignoring message for different instance:", request.instanceId);
        return;
    }

    console.log("Sidepanel received message for this instance:", request.action);

    switch (request.action) {
        case "streamStart":
            addMessage("", 'gemini', false);
            clearError();
            updateStreamingUI(true);
            break;

        case "streamChunk":
            if (currentGeminiMessageDiv) {
                addMessage(request.chunk, 'gemini', false);
            } else {
                console.warn("Received stream chunk but no active message div.");
                addMessage(request.chunk, 'gemini', true);
            }
            break;

        case "streamEnd":
            console.log("Stream ended.");
            updateStreamingUI(false);
            break;

        case "streamError":
            console.error("Streaming Error:", request.error);
            displayError(`Error: ${request.error}`);
            updateStreamingUI(false);
             if (!currentGeminiMessageDiv) {
                 addMessage(`[Error: ${request.error}]`, 'gemini', true);
             } else {
                  currentOutputText += `\n[Error: ${request.error}]`;
                  currentGeminiMessageDiv.querySelector('.message-content').textContent = currentOutputText;
                  addCopyButton(currentGeminiMessageDiv, currentOutputText);
                  currentGeminiMessageDiv = null;
                  currentOutputText = '';
             }
            break;

         case "streamAbort":
            console.log("Stream aborted by user.");
             if (currentGeminiMessageDiv) {
                 currentOutputText += "\n[Generation stopped by user]";
                 currentGeminiMessageDiv.querySelector('.message-content').textContent = currentOutputText;
                 addCopyButton(currentGeminiMessageDiv, currentOutputText);
             } else {
                 addMessage("[Generation stopped by user]", 'gemini', true);
             }
            updateStreamingUI(false);
            break;
    }
});
