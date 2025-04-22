// content.js
import { Readability } from '@mozilla/readability';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getDOM") {

    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    let content = '';
    if (article && article.textContent) {
        content = article.textContent;
    } else {
        content = document.body.innerText || document.documentElement.textContent || '';
    }

    const maxSize = 500000;
    if (content.length > maxSize) {
        content = content.substring(0, maxSize);
    }

    sendResponse({ domContent: content });
  }
});
