// sidepanel.js
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm'; // GitHub Flavored Markdown (tables, strikethrough, etc.)
import remarkMath from 'remark-math'; // Support math syntax like $...$ and $$...$$
import remarkRehype from 'remark-rehype'; // Convert Markdown AST to HTML AST
import rehypeKatex from 'rehype-katex'; // Render math using KaTeX
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'; // Sanitize HTML
import rehypeStringify from 'rehype-stringify'; // Convert HTML AST to string

// KaTeX CSS is loaded via CDN in sidepanel.html

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

// Provider Settings Elements
const providerSelect = document.getElementById('providerSelect');
const geminiSettings = document.getElementById('geminiSettings');
const openaiSettings = document.getElementById('openaiSettings');
const anthropicSettings = document.getElementById('anthropicSettings');
const customSettings = document.getElementById('customSettings');
const allProviderSettings = document.querySelectorAll('.provider-settings'); // Helper selector

// Note: The original apiKeyInput now specifically refers to the Gemini key input
const geminiApiKeyInput = document.getElementById('geminiApiKey'); // Renamed from apiKeyInput for clarity if needed elsewhere, though original variable name is kept for now.

let isStreaming = false;
let currentGeminiMessageDiv = null;
let currentOutputText = '';
const sidePanelInstanceId = crypto.randomUUID();
// console.log("Side Panel Instance ID:", sidePanelInstanceId); // Removed log

// Configure the unified processor
const processor = unified()
    .use(remarkParse) // Parse Markdown text -> mdast
    .use(remarkGfm) // Support GFM features
    .use(remarkMath) // Support math syntax
    .use(remarkRehype) // mdast -> hast (HTML AST)
    .use(rehypeKatex) // Render math in hast using KaTeX
    .use(rehypeSanitize, { // Sanitize the resulting HTML
        ...defaultSchema, // Start with the default safe schema
        // Allow classes needed by KaTeX
        clobberPrefix: '', // Don't prefix IDs/names
        attributes: {
            ...defaultSchema.attributes,
            // Allow KaTeX classes on spans, divs, etc.
            span: [...(defaultSchema.attributes?.span || []), ['className', /^katex/]],
            div: [...(defaultSchema.attributes?.div || []), ['className', 'math']], // Allow math display divs
            '*': [...(defaultSchema.attributes?.['*'] || []), 'aria-hidden'], // Allow aria-hidden used by KaTeX
        },
    })
    .use(rehypeStringify); // hast -> HTML string

// --- Initialization ---

function toggleApiKeySection(show) {
    if (show) {
        apiKeyDetails.classList.remove('hidden');
        apiKeyToggleIndicator.classList.add('rotate-180');
    } else {
        apiKeyDetails.classList.add('hidden');
        apiKeyToggleIndicator.classList.remove('rotate-180');
    }
}

document.addEventListener('DOMContentLoaded', () => {
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
    updateStreamingUI(false);

    // Add input listener for textarea auto-resize (CSP-compliant)
    messageInput.addEventListener('input', () => {
        // Reset height to shrink if text is deleted
        messageInput.style.height = 'auto';
        // Set height based on scroll height
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });

    // Add listener for provider selection change
    providerSelect.addEventListener('change', handleProviderChange);

    // Initial setup based on default selection (Gemini)
    handleProviderChange(); // Call once to set initial state
});

// --- Provider Settings Visibility ---
function handleProviderChange() {
    const selectedProvider = providerSelect.value;

    // Hide all provider settings sections
    allProviderSettings.forEach(div => div.classList.add('hidden'));

    // Show the selected one
    switch (selectedProvider) {
        case 'gemini':
            geminiSettings.classList.remove('hidden');
            break;
        case 'openai':
            openaiSettings.classList.remove('hidden');
            break;
        case 'anthropic':
            anthropicSettings.classList.remove('hidden');
            break;
        case 'custom':
            customSettings.classList.remove('hidden');
            break;
    }
    // Note: The save button logic currently only targets the Gemini key.
    // Further logic would be needed to save settings for the selected provider.
}

// Function to add messages to the chatbox (using unified)
async function addMessage(text, sender, isComplete = true) {
    const isGemini = sender === 'gemini';
    let contentHtml = ''; // To store processed HTML

    if (isGemini) {
        // Process Gemini text (cumulative or complete)
        currentOutputText = (!isComplete && currentGeminiMessageDiv) ? currentOutputText + text : text;
        try {
            const file = await processor.process(currentOutputText);
            contentHtml = String(file);
        } catch (error) {
            console.error("Markdown processing error:", error);
            contentHtml = `<p>Error rendering content.</p><pre><code>${currentOutputText.replace(/</g, "<").replace(/>/g, ">")}</code></pre>`; // Fallback
        }
    } else {
        // User message is plain text, escape it for safety if needed, but usually fine for textContent
        contentHtml = text; // Keep user text as is for now
    }


    if (isGemini && !isComplete && currentGeminiMessageDiv) {
        // Update existing message div
        currentGeminiMessageDiv.querySelector('.message-content').innerHTML = contentHtml;
    } else {
        // Create new message div
        const messageDiv = document.createElement('div');
        const contentSpan = document.createElement('span');
        contentSpan.classList.add('message-content'); // Base class

        if (isGemini) {
            contentSpan.innerHTML = contentHtml;
        } else {
            contentSpan.textContent = contentHtml; // Set user text
        }

        if (sender === 'user') {
            messageDiv.classList.add('bg-gray-100', 'p-3', 'rounded-xl', 'max-w-[85%]', 'self-end', 'break-words', 'text-foreground');
            messageDiv.appendChild(contentSpan);
        } else { // Gemini message (start or complete)
            messageDiv.classList.add('bg-transparent', 'p-3', 'rounded-xl', 'max-w-[85%]', 'self-start', 'relative', 'group', 'break-words', 'text-foreground');
            messageDiv.appendChild(contentSpan);

            if (isComplete) {
                addCopyButton(messageDiv, text); // Copy the original markdown text
                currentGeminiMessageDiv = null;
                currentOutputText = '';
            } else {
                currentGeminiMessageDiv = messageDiv;
                // Don't add copy button yet
            }
        }
        chatbox.appendChild(messageDiv);
    }

    chatbox.scrollTop = chatbox.scrollHeight;
    return currentGeminiMessageDiv;
}

// Helper to add copy button
function addCopyButton(messageDiv, textToCopy) {
     if (!messageDiv || messageDiv.querySelector('.copy-button')) return;

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.classList.add(
        'copy-button', 'absolute', 'bottom-1', 'right-1', 'bg-muted', 'text-muted-foreground',
        'text-xs', 'px-1.5', 'py-0.5', 'rounded-md', 'opacity-0', 'group-hover:opacity-100',
        'transition-opacity', 'focus:outline-none', 'focus:ring-1', 'focus:ring-ring'
    );
    copyButton.onclick = () => {
        navigator.clipboard.writeText(textToCopy) // Copy raw markdown text
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


function displayError(message) {
     errorDisplay.textContent = message;
     console.error("Error displayed to user:", message);
}

function clearError() {
    errorDisplay.textContent = '';
}

function updateStreamingUI(streaming) {
    isStreaming = streaming; // Keep track of the streaming state
    if (streaming) {
        sendMessageButton.classList.add('hidden');
        stopGeneratingButton.classList.remove('hidden');
        messageInput.disabled = true;
    } else {
        // Only manage UI elements state here, not message content or state vars
        sendMessageButton.classList.remove('hidden');
        stopGeneratingButton.classList.add('hidden');
        messageInput.disabled = false;
        messageInput.focus();
    }
}

// Make handleSendMessage async because addMessage is now async
async function handleSendMessage() {
    const messageText = messageInput.value.trim();
    if (!messageText || isStreaming) return;

    clearError();
    await addMessage(messageText, 'user'); // Await user message addition (though it's sync)
    messageInput.value = '';
    messageInput.style.height = 'auto';
    updateStreamingUI(true);

    chrome.runtime.sendMessage(
        {
            action: "processChat",
            message: messageText,
            instanceId: sidePanelInstanceId
        }
        // No callback needed here, communication is handled by stream messages
        // If an immediate error occurs sending the message (e.g., service worker inactive),
        // it might throw an error that could be caught, but typically we rely on streamError.
    );
    // Consider adding a try/catch around the sendMessage if needed,
    // but the primary communication channel is the listener below.
}

// --- Event Listeners ---

toggleApiKeyVisibilityButton.addEventListener('click', () => {
    const isHidden = apiKeyDetails.classList.contains('hidden');
    toggleApiKeySection(isHidden);
});

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

// Make event listeners call the async version
sendMessageButton.addEventListener('click', () => { handleSendMessage().catch(console.error); });

messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage().catch(console.error);
    }
});

stopGeneratingButton.addEventListener('click', () => {
    if (!isStreaming) return;
    // console.log("Stop Generating button clicked."); // Removed log
    stopGeneratingButton.disabled = true;
    stopGeneratingButton.textContent = 'Stopping...';

    chrome.runtime.sendMessage(
        { action: "stopGeneration", instanceId: sidePanelInstanceId },
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
             // console.warn("Stop generation request failed:", response.message); // Keep warn? Maybe displayError? For now remove.
             displayError(`Stop request failed: ${response.message || 'Unknown reason'}`); // Display error instead
         } else {
             // console.log("Stop request acknowledged by service worker."); // Removed log
         }
    });
});

// Make message listener async
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.instanceId && request.instanceId !== sidePanelInstanceId) {
        return; // Ignore messages not for this instance
    }
    // console.log("Sidepanel received message for this instance:", request.action); // Removed log

    // Use an async IIFE to handle potential async operations within the switch
    (async () => {
        switch (request.action) {
            case "streamStart":
                await addMessage("", 'gemini', false); // Await message addition
                clearError();
                updateStreamingUI(true);
                break;
            case "streamChunk":
                if (currentGeminiMessageDiv) {
                    await addMessage(request.chunk, 'gemini', false); // Await message update
                } else {
                    // console.warn("Received stream chunk but no active message div."); // Removed log
                    // If we get a chunk but have no div, maybe start a new one?
                    await addMessage(request.chunk, 'gemini', false); // Treat as start of stream if no div exists
                }
                break;
            case "streamEnd":
                // Finalize the message content state
                if (currentGeminiMessageDiv && currentOutputText) {
                    addCopyButton(currentGeminiMessageDiv, currentOutputText); // Add copy button with final text
                }
                // Reset message state variables
                currentGeminiMessageDiv = null;
                currentOutputText = '';
                // Reset UI elements state (buttons, input)
                updateStreamingUI(false);
                break;
            case "streamError":
                console.error("Streaming Error:", request.error);
                displayError(`Error: ${request.error}`);
                 if (!currentGeminiMessageDiv) {
                     await addMessage(`[Error: ${request.error}]`, 'gemini', true);
                 } else {
                      currentOutputText += `\n[Error: ${request.error}]`;
                      const renderedHtml = await processor.process(currentOutputText); // Use await here
                      currentGeminiMessageDiv.querySelector('.message-content').innerHTML = String(renderedHtml);
                      addCopyButton(currentGeminiMessageDiv, currentOutputText);
                      currentGeminiMessageDiv = null;
                      currentOutputText = '';
                 }
                 updateStreamingUI(false); // Reset UI after handling error message
                break;
             case "streamAbort":
                // console.log("Stream aborted by user."); // Removed log
                 if (currentGeminiMessageDiv) {
                     currentOutputText += "\n[Generation stopped by user]";
                     const renderedHtml = await processor.process(currentOutputText); // Use await here
                     currentGeminiMessageDiv.querySelector('.message-content').innerHTML = String(renderedHtml);
                     addCopyButton(currentGeminiMessageDiv, currentOutputText);
                 } else {
                     await addMessage("[Generation stopped by user]", 'gemini', true);
                 }
                updateStreamingUI(false);
                break;
        }
    })().catch(console.error); // Catch any errors from the async IIFE

    // Return false as we are not using sendResponse asynchronously here
    return false;
});
