/**
 * Host matching for a composer adapter.
 *
 * A composer adapter claims a **host**, not a path, and the difference from the capture adapters is
 * deliberate: a conversation is captured on a conversation URL, but context is placed on whatever
 * page of the provider's app the user is on — the new-chat page is in fact the most likely one, and
 * it is exactly the page a `conversationRoot`-shaped capture adapter refuses to claim.
 *
 * The `endsWith` arm accepts the regional and staging subdomains the providers actually serve from
 * (`chat.openai.com`, `foo.chatgpt.com`), which is the same rule the capture adapters use.
 */
export function matchesHosts(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const host = parsed.hostname.toLowerCase();
  return hosts.some((known) => host === known || host.endsWith(`.${known}`));
}
