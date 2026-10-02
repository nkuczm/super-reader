"use client";

import { useState } from "react";
import { authorsOf, cleanLinkedIn, contactId, type Card, type ContactItem } from "@/lib/subjects";

const HIDE_SUGGESTED_KEY = "super-reader:hide-suggested-contacts";

type Detail = "email" | "phone" | "linkedin";

/**
 * The subject's contacts: people to interview, from the stories and
 * suggested beside them. Details come from the stories or from the reader —
 * the AI is never asked to guess an address.
 */
export default function SubjectContacts({
  contacts,
  cards,
  running,
  canRun,
  onRun,
  onSave,
  onRemove,
  onAdd,
  onOpenCard,
  dismissedIds,
}: {
  contacts: ContactItem[];
  cards: Card[];
  running: boolean;
  canRun: boolean;
  onRun: () => void;
  onSave: (contact: ContactItem) => void;
  onRemove: (contact: ContactItem) => void;
  onAdd: (name: string, role: string) => void;
  onOpenCard: (card: Card) => void;
  /** People removed from the list, so an author removed is not brought back. */
  dismissedIds: string[];
}) {
  const [adding, setAdding] = useState<{ name: string; role: string } | null>(null);
  // The stories' own authors are contacts without asking: a byline is the
  // surest lead there is. One removed stays removed (a dismissed item).
  const held = new Map(contacts.map((c) => [c.id, c]));
  const dismissed = new Set(dismissedIds);
  const authors: ContactItem[] = authorsOf(cards).flatMap(({ name, refs }) => {
    const id = contactId(name);
    if (dismissed.has(id)) return [];
    const mine = held.get(id);
    return [
      mine
        ? { ...mine, refs: [...new Set([...refs, ...mine.refs])] }
        : { id, kind: "contact" as const, name, role: "Author", why: "", refs, origin: "story" as const, state: "kept" as const, at: 0 },
    ];
  });
  const authorIds = new Set(authors.map((a) => a.id));
  const fromStories = contacts.filter((c) => c.origin === "story" && !authorIds.has(c.id));
  // Yours first: people you added, and suggestions you accepted.
  const yours = contacts.filter((c) => c.origin === "you" || (c.origin === "suggested" && c.state === "kept"));
  const suggested = contacts.filter((c) => c.origin === "suggested" && c.state !== "kept");
  const [hideSuggested, setHideSuggested] = useState(() => {
    try {
      return localStorage.getItem(HIDE_SUGGESTED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSuggested = () =>
    setHideSuggested((v) => {
      try {
        localStorage.setItem(HIDE_SUGGESTED_KEY, v ? "0" : "1");
      } catch {
        /* not remembered */
      }
      return !v;
    });
  const byId = new Map(cards.map((card) => [card.id, card]));

  const section = (title: string, list: ContactItem[], note?: string, refsLabel?: (n: number) => string) =>
    list.length > 0 && (
      <section className="contacts-section">
        {title && <h2>{title}</h2>}
        {note && <p className="sub">{note}</p>}
        <ul className="contacts-list">
          {list.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              // Only someone actually in the stories has stories to list.
              stories={contact.origin === "suggested" ? [] : contact.refs.map((ref) => byId.get(ref)).filter((c): c is Card => !!c)}
              refsLabel={refsLabel ?? ((n) => `Mentioned in ${n} ${n === 1 ? "story" : "stories"}`)}
              onSave={onSave}
              onRemove={onRemove}
              onOpenCard={onOpenCard}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="contacts-page">
      <div className="contacts-bar">
        <button className="btn ghost small" disabled={!canRun || running} onClick={onRun}
          title="Look through the stories for people to interview">
          {running ? "Finding people…" : "✦ Find people"}
        </button>
        <button className="btn ghost small" onClick={() => setAdding({ name: "", role: "" })}>+ Add contact</button>
      </div>
      {adding && (
        <form
          className="contact-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (adding.name.trim()) onAdd(adding.name.trim(), adding.role.trim());
            setAdding(null);
          }}
        >
          <input className="input" autoFocus placeholder="Name" value={adding.name}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <input className="input" placeholder="Role or organisation" value={adding.role}
            onChange={(e) => setAdding({ ...adding, role: e.target.value })} />
          <button className="btn small" disabled={!adding.name.trim()}>Add</button>
          <button type="button" className="link-btn" onClick={() => setAdding(null)}>Cancel</button>
        </form>
      )}
      {contacts.length === 0 && !adding && (
        <p className="contacts-empty">
          No contacts yet. <b>Find people</b> reads this subject&apos;s stories for the people in them and those connected
          to them — or add someone yourself.
        </p>
      )}
      {section("Your contacts", yours)}
      {section("Authors", authors, undefined, (n) => `Wrote ${n} ${n === 1 ? "story" : "stories"} here`)}
      {section("In the stories", fromStories)}
      {suggested.length > 0 && (
        <div className="contacts-suggested-head">
          <h2>Suggested</h2>
          <button className="link-btn" onClick={toggleSuggested}>{hideSuggested ? `Show (${suggested.length})` : "Hide"}</button>
        </div>
      )}
      {!hideSuggested && section("", suggested)}
    </div>
  );
}

function ContactRow({
  contact,
  stories,
  onSave,
  onRemove,
  onOpenCard,
  refsLabel,
}: {
  refsLabel: (n: number) => string;
  contact: ContactItem;
  stories: Card[];
  onSave: (contact: ContactItem) => void;
  onRemove: (contact: ContactItem) => void;
  onOpenCard: (card: Card) => void;
}) {
  const [editing, setEditing] = useState<{ kind: Detail; value: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showRefs, setShowRefs] = useState(false);

  const save = () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (editing.kind === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setProblem("That doesn't look like an email address.");
      return;
    }
    if (editing.kind === "linkedin") {
      const link = value ? cleanLinkedIn(value) : null;
      if (value && !link) {
        setProblem("That doesn't look like a LinkedIn profile link.");
        return;
      }
      onSave({ ...contact, linkedin: link ?? undefined, state: "kept" });
      setEditing(null);
      setProblem(null);
      return;
    }
    if (editing.kind === "phone" && value && value.replace(/\D/g, "").length < 6) {
      setProblem("That doesn't look like a phone number.");
      return;
    }
    onSave(
      editing.kind === "email"
        ? { ...contact, email: value || undefined, emailFrom: value ? "you" : undefined, state: "kept" }
        : { ...contact, phone: value || undefined, state: "kept" },
    );
    setEditing(null);
    setProblem(null);
  };

  return (
    <li className={`contact${contact.state === "pending" && contact.origin === "suggested" ? " pending" : ""}`}>
      <div className="contact-main">
        <div className="contact-name">
          {contact.name}
          {contact.role && <span className="contact-role">{contact.role}</span>}
        </div>
        {contact.why && <p className="contact-why">{contact.why}</p>}
        {stories.length > 0 && (
          <div className="contact-refs">
            <button className="link-btn contact-refs-toggle" aria-expanded={showRefs} onClick={() => setShowRefs((v) => !v)}>
              {refsLabel(stories.length)} {showRefs ? "▾" : "▸"}
            </button>
            {showRefs && (
              <ul>
                {stories.map((card) => (
                  <li key={card.id}>
                    <button className="link-btn" onClick={() => onOpenCard(card)}>{card.title}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="contact-details">
          {contact.email && (
            <a href={`mailto:${contact.email}`}>
              {contact.email}
              {contact.emailFrom === "story" && <span className="contact-from"> · from the story</span>}
            </a>
          )}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>}
          {contact.linkedin && cleanLinkedIn(contact.linkedin) && (
            <a href={cleanLinkedIn(contact.linkedin)!} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
          )}
          {!contact.email && !contact.phone && !contact.linkedin && !editing && <span className="contact-none">No email found in the stories</span>}
        </div>
        <textarea
          className="contact-notes"
          placeholder="Notes…"
          defaultValue={contact.notes ?? ""}
          rows={1}
          ref={(el) => {
            // Tall enough for notes already written.
            if (el && el.value) {
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onBlur={(e) => {
            const value = e.currentTarget.value.slice(0, 4000);
            if (value !== (contact.notes ?? "")) onSave({ ...contact, notes: value || undefined, state: "kept" });
          }}
        />
        {editing ? (
          <form
            className="contact-edit"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <select
              className="input"
              value={editing.kind}
              aria-label="Detail"
              onChange={(e) => {
                const kind = e.target.value as Detail;
                setEditing({ kind, value: (kind === "email" ? contact.email : kind === "phone" ? contact.phone : contact.linkedin) ?? "" });
              }}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="linkedin">LinkedIn</option>
            </select>
            <input
              className="input"
              autoFocus
              type={editing.kind === "email" ? "email" : editing.kind === "phone" ? "tel" : "url"}
              placeholder={
                editing.kind === "email" ? "name@example.com" : editing.kind === "phone" ? "+1 555 010 0000" : "linkedin.com/in/name"
              }
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
            />
            <button className="btn small">Save</button>
            <button type="button" className="link-btn" onClick={() => setEditing(null)}>Cancel</button>
            {problem && <span className="signin-error">{problem}</span>}
          </form>
        ) : (
          <button className="link-btn contact-add-detail" onClick={() => setEditing({ kind: "email", value: contact.email ?? "" })}>
            {contact.email || contact.phone || contact.linkedin ? "Edit email, phone or LinkedIn ▾" : "Add email, phone or LinkedIn ▾"}
          </button>
        )}
      </div>
      <div className="contact-actions">
        {contact.state === "pending" && contact.origin === "suggested" && (
          <button className="decide accept" aria-label={`Keep ${contact.name}`} title="Keep"
            onClick={() => onSave({ ...contact, state: "kept" })}>✓</button>
        )}
        <button className="decide dismiss" aria-label={`Remove ${contact.name}`} title="Remove"
          onClick={() => onRemove(contact)}>✕</button>
      </div>
    </li>
  );
}
