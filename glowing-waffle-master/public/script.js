const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');
const sendButton = chatForm.querySelector('button[type="submit"]');

// Helper to add messages to the UI
const appendMessage = (role, text) => {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.textContent = text;
  chatBox.appendChild(messageDiv);

  // Keep the chat scrolled to the bottom
  chatBox.scrollTop = chatBox.scrollHeight;
  return messageDiv;
};

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const message = userInput.value.trim();
  if (!message) return;

  // 1. Add user's message to the chat box
  appendMessage('user', message);

  // Clear the input field so they can type the next one
  userInput.value = '';

  // Disable input and button while waiting for response
  userInput.disabled = true;
  sendButton.disabled = true;

  // 2. Show a temporary "Thinking..." bot message
  const thinkingMessage = appendMessage('model', 'Thinking...');

  try {
    // 3. Send the POST request to /chat
    const response = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: [
          { role: 'user', text: message }
        ]
      }),
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();

    // 4. Replace "Thinking..." with the AI's reply
    if (data && data.result) {
      thinkingMessage.textContent = data.result;
    } else {
      thinkingMessage.textContent = 'Sorry, no response received.';
    }

  } catch (error) {
    // 5. Proper error handling
    console.error('Fetch error:', error);
    thinkingMessage.textContent = 'Failed to get response from server.';
  } finally {
    // Re-enable input and button
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus(); // Optional: put focus back on the input field
  }
});
