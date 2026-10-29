export function getAuthErrorMessage(error, mode) {
  const message = String(error?.message ?? "").toLocaleLowerCase();
  if (message.includes("invalid login credentials")) {
    return "The email or password is incorrect. Check your details and try again.";
  }
  if (message.includes("email not confirmed")) {
    return "Verify your email before logging in.";
  }
  if (message.includes("too many requests")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (mode === "signup" && message.includes("already registered")) {
    return "An account already exists for this email. Try logging in instead.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "Authentication could not be completed. Check your connection and try again.";
  }
  return mode === "signup"
    ? "Your account could not be created. Check your details and try again."
    : "You could not be signed in. Check your details and try again.";
}
