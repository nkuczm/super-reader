import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Reader",
  description: "Paste a link or a topic. Get a feed you can actually read.",
  applicationName: "Super Reader",
  // Lets iOS run it as a standalone app once added to the Home Screen.
  appleWebApp: {
    capable: true,
    title: "Reader",
    // "default" keeps iOS from drawing the page under the status bar; the
    // safe-area padding in the stylesheet covers devices that still do.
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  other: {
    // Next emits the modern mobile-web-app-capable; iOS before 16.4 still
    // needs the Apple-prefixed one to launch without Safari chrome.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Content extends under the notch; safe-area insets handle the padding.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Before any of the app's code: if a script fails to parse or run in
            this browser, the page would just be blank, so say why — to the
            server log, and on screen once the page has had time to start. */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_ERRORS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const EARLY_ERRORS = `(function(){
  var n=0;
  function send(where,msg,stack){
    if(n++>4)return;
    try{
      var b=JSON.stringify({where:where,message:String(msg||"").slice(0,500),stack:String(stack||"").slice(0,3000),userAgent:navigator.userAgent.slice(0,300),path:location.pathname});
      if(!(navigator.sendBeacon&&navigator.sendBeacon("/api/client-error",new Blob([b],{type:"application/json"}))))fetch("/api/client-error",{method:"POST",body:b,keepalive:true});
    }catch(e){}
  }
  window.__earlyErrors=[];
  window.addEventListener("error",function(e){
    var msg=e.message||(e.target&&e.target.src?"Failed to load "+e.target.src:"error");
    window.__earlyErrors.push(msg);
    send("early",msg,e.error&&e.error.stack);
  },true);
  window.addEventListener("unhandledrejection",function(e){send("early-rejection",e.reason&&e.reason.message||e.reason,e.reason&&e.reason.stack);});
  setTimeout(function(){
    if(document.querySelector(".app")||!window.__earlyErrors.length)return;
    var d=document.createElement("div");
    d.style.cssText="padding:40px 20px;font:15px/1.5 system-ui,sans-serif;max-width:520px;margin:0 auto";
    d.innerHTML="<h1 style='font-size:21px'>Super Reader could not start</h1><p>This browser stopped on: </p><pre style='white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:8px;font-size:12px'></pre><p>It has been reported.</p><button style='padding:10px 16px;font-size:15px'>Reload</button>";
    d.querySelector("pre").textContent=window.__earlyErrors.join("\\n");
    d.querySelector("button").onclick=function(){location.reload()};
    document.body.prepend(d);
  },6000);
})();`;
