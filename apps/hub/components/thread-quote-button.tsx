"use client";

export function ThreadQuoteButton({ postNo, body }: { postNo: number; body: string }) {
  return <button type="button" className="thread-quote-button" onClick={() => {
    const selection = window.getSelection()?.toString().trim();
    window.dispatchEvent(new CustomEvent("hub:thread-quote", { detail: { no: postNo, text: selection || body } }));
    document.getElementById("thread-reply-body")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }}>引用して返信</button>;
}
