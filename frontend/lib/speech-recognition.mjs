const speechErrors = {
  "not-allowed": "Microphone permission was denied. Allow microphone access or type your question.",
  "service-not-allowed": "Microphone access is blocked by your browser or device. You can type instead.",
  "audio-capture": "No microphone was found. Connect a microphone or type your question.",
  "no-speech": "We didn’t hear anything. Try again or type your question.",
  network: "Voice recognition needs an internet connection. You can type your question.",
};

export function getSpeechRecognitionConstructor(browserWindow) {
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

export function speechRecognitionErrorMessage(error) {
  return speechErrors[error] ?? "Voice input stopped unexpectedly. Please try again or type your question.";
}

export function startSpeechRecognition(browserWindow, language, callbacks) {
  const Recognition = getSpeechRecognitionConstructor(browserWindow);
  if (!Recognition) return "unsupported";

  const recognition = new Recognition();
  let receivedTranscript = false;
  let recognitionFailed = false;
  recognition.lang = language;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    const transcript = Array.from({ length: event.results.length }, (_, index) =>
      event.results[index][0].transcript,
    ).join(" ").trim();
    if (transcript) {
      receivedTranscript = true;
      callbacks.onTranscript(transcript);
    }
  };
  recognition.onerror = (event) => {
    recognitionFailed = true;
    callbacks.onError(speechRecognitionErrorMessage(event.error));
  };
  recognition.onend = () => callbacks.onEnd({ receivedTranscript, recognitionFailed });

  try {
    recognition.start();
    callbacks.onStarted(recognition);
    return "started";
  } catch {
    callbacks.onStartFailure();
    return "failed";
  }
}
