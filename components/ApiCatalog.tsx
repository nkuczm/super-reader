"use client";

import { useEffect, useState } from "react";
import type { ApiCatalogEntry, ApiParams } from "@/lib/apis";
import SourceIcon from "./SourceIcon";

type Props = {
  /** Called with an `api:` source URL once the fields are filled in. */
  onPreview: (sourceUrl: string) => void;
  busy: boolean;
};

/**
 * The directory of data APIs. Picking one opens its fields; filling them in
 * builds an `api:` source URL, which previews through the same path as any
 * pasted site.
 */
export default function ApiCatalog({ onPreview, busy }: Props) {
  const [apis, setApis] = useState<ApiCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [values, setValues] = useState<ApiParams>({});

  useEffect(() => {
    let live = true;
    fetch("/api/apis")
      .then((res) => res.json())
      .then((data) => {
        if (live) setApis(data.apis as ApiCatalogEntry[]);
      })
      .catch(() => live && setError("Could not load the API directory."));
    return () => {
      live = false;
    };
  }, []);

  function open(entry: ApiCatalogEntry) {
    const next = openId === entry.id ? null : entry.id;
    setOpenId(next);
    // Start from each field's default so a select is never blank.
    const defaults: ApiParams = {};
    for (const param of entry.params) {
      if (param.default) defaults[param.key] = param.default;
    }
    setValues(defaults);
  }

  function submit(entry: ApiCatalogEntry) {
    const search = new URLSearchParams();
    for (const param of entry.params) {
      const value = values[param.key]?.trim();
      if (value) search.set(param.key, value);
    }
    const qs = search.toString();
    onPreview(`api:${entry.id}${qs ? `?${qs}` : ""}`);
  }

  if (error) return <p className="error">{error}</p>;
  if (!apis) return <p className="api-note">Loading the directory…</p>;

  const categories = [...new Set(apis.map((entry) => entry.category))];

  return (
    <div className="api-catalog">
      {categories.map((category) => (
        <section key={category}>
          <h3 className="api-category">{category}</h3>
          {apis
            .filter((entry) => entry.category === category)
            .map((entry) => {
              const isOpen = openId === entry.id;
              const missing = entry.params.some(
                (param) => param.required && !values[param.key]?.trim(),
              );
              return (
                <div key={entry.id} className={`api-row${isOpen ? " open" : ""}`}>
                  <button className="api-head" onClick={() => open(entry)}>
                    <SourceIcon src={entry.favicon} title={entry.name} size={22} />
                    <span className="api-name">
                      {entry.name}
                      {!entry.ready && <em className="badge">needs a key</em>}
                    </span>
                    <span className="api-desc">{entry.description}</span>
                  </button>

                  {isOpen && (
                    <div className="api-form">
                      {entry.keyNote && <p className="api-note">{entry.keyNote}</p>}
                      {entry.params.map((param) => (
                        <label key={param.key} className="api-field">
                          <span>
                            {param.label}
                            {param.required && <i aria-hidden="true"> *</i>}
                          </span>
                          {param.options ? (
                            <select
                              className="select"
                              value={values[param.key] ?? param.default ?? ""}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [param.key]: event.target.value,
                                }))
                              }
                            >
                              {param.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="input"
                              placeholder={param.placeholder}
                              value={values[param.key] ?? ""}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [param.key]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && !missing) submit(entry);
                              }}
                            />
                          )}
                          {param.hint && <small>{param.hint}</small>}
                        </label>
                      ))}
                      <div className="api-actions">
                        <a
                          className="api-docs"
                          href={entry.docsUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          API docs
                        </a>
                        <button
                          className="btn small"
                          disabled={busy || missing}
                          onClick={() => submit(entry)}
                        >
                          {busy ? <span className="spinner" /> : "Preview"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </section>
      ))}
    </div>
  );
}
