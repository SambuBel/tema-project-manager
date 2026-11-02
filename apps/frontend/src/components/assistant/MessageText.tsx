const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

/** El chat es texto plano: lo único que se convierte son las URLs, para abrir la tarea que creó el asistente. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, index) => {
        if (index % 2 === 0) return part;
        const url = part.replace(TRAILING_PUNCTUATION, '');
        return (
          <span key={index}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline">
              {url}
            </a>
            {part.slice(url.length)}
          </span>
        );
      })}
    </>
  );
}
