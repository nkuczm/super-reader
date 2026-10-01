"use client";

import { useState } from "react";
import type { Card, ContactItem } from "@/lib/subjects";

type Detail = "email" | "phone";

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
}) {
  const [adding, setAdding] = useState<{ name: string; role: string } | null>(null);
  const fromStories = contacts.filter((c) => c.origin === "story");
  const suggested = contacts.filter((c) => c.origin === "suggested");
  const yours = contacts.filter((c) => c.origin === "you");
  const byId = new Map(cards.map((card) => [card.id, card]));

  const section = (title: string, list: ContactItem[], note?: string) =>
    list.length > 0 && (
      <section className="contacts-section">
        <h2>{title}</h2>
        {note && <p className="sub">{note}</p>}
        <ul className="contacts-list">
          {list.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              stories={contact.refs.map((ref) => byId.get(ref)).filter((c): c is Card => !!c)}
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
      {section("In the stories", fromStories)}
      {section("Suggested", suggested, "Connected to the stories but not in them — check the role before reaching out.")}
      {section("Added by you", yours)}
    </div>
  );
}

function ContactRow({
  contact,
  stories,
  onSave,
  onRemove,
  onOpenCard,
}: {
  contact: ContactItem;
  stories: Card[];
  onSave: (contact: ContactItem) => void;
  onRemove: (contact: ContactItem) => void;
  onOpenCard: (card: Card) => void;
}) {
  const [editing, setEditing] = useState<{ kind: Detail; value: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (editing.kind === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setProblem("That doesn't look like an email address.");
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
          <p className="contact-refs">
            {stories.map((card, i) => (
              <span key={card.id}>
                {i > 0 && " · "}
                <button className="link-btn" onClick={() => onOpenCard(card)}>{card.title}</button>
              </span>
            ))}
          </p>
        )}
        <div className="contact-details">
          {contact.email && (
            <a href={`mailto:${contact.email}`}>
              {contact.email}
              {contact.emailFrom === "story" && <span className="contact-from"> · from the story</span>}
            </a>
          )}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>}
          {!contact.email && !contact.phone && !editing && <span className="contact-none">No email found in the stories</span>}
        </div>
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
                setEditing({ kind, value: (kind === "email" ? contact.email : contact.phone) ?? "" });
              }}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
            <input
              className="input"
              autoFocus
              type={editing.kind === "email" ? "email" : "tel"}
              placeholder={editing.kind === "email" ? "name@example.com" : "+1 555 010 0000"}
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
            {contact.email || contact.phone ? "Edit email or phone ▾" : "Add email or phone ▾"}
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
