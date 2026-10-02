import type { Metadata } from "next";
import styles from "./extension.module.css";

export const metadata: Metadata = {
  title: "Super Reader for Chrome",
  description: "Save the article you're reading to Super Reader, text and all, and file it into a subject.",
};

/** Where the Chrome extension is downloaded, with the steps to install it. */
export default function ExtensionPage() {
  return (
    <main className={styles.page}>
      <a className={styles.back} href="/">← Super Reader</a>
      <h1>Super Reader for Chrome</h1>
      <p className={styles.lead}>
        Save the article you&apos;re reading — its full text, as your browser shows it, subscriptions included — to
        Saved, and file it into a subject with one click. Select text first to file it as a quote, with a note under it.
      </p>

      <a className={styles.download} href="/super-reader-extension.zip" download>
        Download the extension
      </a>
      <p className={styles.small}>A small .zip — about 100 KB.</p>

      <h2>Install it (about a minute)</h2>
      <ol className={styles.steps}>
        <li>
          Unzip the download. You&apos;ll get a folder called <code>super-reader-extension</code> — keep it somewhere it
          won&apos;t be deleted, since Chrome loads it from there.
        </li>
        <li>
          Open <code>chrome://extensions</code> in Chrome (paste it into the address bar) and switch on{" "}
          <b>Developer mode</b>, top right.
        </li>
        <li>
          Click <b>Load unpacked</b> and choose the <code>super-reader-extension</code> folder.
        </li>
        <li>
          Pin it: click the puzzle-piece icon in Chrome&apos;s toolbar, then the pin beside Super Reader.
        </li>
        <li>
          Click it and paste your sync code — in Super Reader, open <b>Sync across devices</b> at the bottom of the
          sidebar to see it (or turn syncing on there first).
        </li>
      </ol>

      <h2>Use it</h2>
      <p>
        On any article, click the Super Reader icon. Choose a subject — or <b>Just save it</b> — add a note if you like,
        and press <b>Save</b>. It appears in Super Reader&apos;s Saved, and in the subject, the next time you open or
        return to the app.
      </p>
      <p className={styles.small}>
        To update later, download again, replace the folder&apos;s contents, and press the refresh arrow on the
        extension&apos;s card in <code>chrome://extensions</code>. Works in Chrome, Edge, Brave and Arc on a computer;
        phones don&apos;t run browser extensions.
      </p>
    </main>
  );
}
