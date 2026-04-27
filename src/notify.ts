const DEFAULT_SERVER = 'https://ntfy.sh';

export async function sendNtfy(
  topic:    string,
  title:    string,
  message:  string,
  server  = DEFAULT_SERVER,
  priority = 3,
): Promise<void> {
  if (!topic?.trim()) return;
  const url = `${server.replace(/\/$/, '')}/${topic.trim()}`;
  await fetch(url, {
    method:  'POST',
    headers: {
      'Title':    title,
      'Priority': String(priority),
      'Tags':     'briefcase',
    },
    body: message,
  });
}
