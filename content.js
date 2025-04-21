// content.js
import { Readability } from '@mozilla/readability';

console.log("Dolphin Copilot content script loaded.");

// Listen for messages from the background script (service worker)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDOM") {
    console.log("Content script received request for DOM content via Readability.");

    // Clone the document to avoid modifying the original page
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    let content = '';
    if (article && article.textContent) {
        console.log(`Readability extracted content length: ${article.textContent.length}`);
        content = article.textContent;
        // Optional: Could also use article.content for cleaned HTML if needed later
    } else {
        console.warn("Readability could not parse article content. Falling back to body text.");
        // Fallback to simple text extraction if Readability fails
        content = document.body.innerText || document.documentElement.textContent || '';
    }

    // Limit size slightly just in case (adjust as needed)
    const maxSize = 50000; // Approx 50k characters
    if (content.length > maxSize) {
        console.log(`Truncating content from ${content.length} to ${maxSize} characters.`);
        content = content.substring(0, maxSize);
    }

    sendResponse({ domContent: content }); // Send plain text content
    return true; // Indicates response will be sent asynchronously
  }
});
