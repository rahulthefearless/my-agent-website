import { useState, useEffect, useRef } from "react";
import { GitHubMemory } from "./github.js";
import { askAgent } from "./gemini.js";

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TONES = ["Calm","Firm","Defensive","Empathetic","Assertive","Dismissive","Frustrated","Neutral","Joking","Cold"];
const SPEAKERS = ["Me","Friend","Partner","Family","Boss","Colleague","Stranger","Client"];

const STORAGE_KEY = "myagent_config";

function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
}

export default function App() {
  const [view, setView] = useState("setup");
  const [config, setConfig] = useState({ token: "", owner: "", repo: "", geminiKey: "" });
  const [memory, setMemory] = useState(null);
  const [github, setGithub] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [libTab, setLibTab] = useState("decisions");

  // Chat
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const chatEndRef = useRef(null);

  // Scenario train
  const [trainForm, setTrainForm] = useState({ situation: "", decision: "", reasoning: "", tags: "" });

  // Convo train
  const [convForm, setConvForm] = useState({ context: "", outcome: "", tags: "" });
  const [turns, setTurns] = useState([{ speaker: "me", message: "", myTone: "", myReaction: "" }]);

  // Profile
  const [profileForm, setProfileForm] = useState({ name: "", style: "", traits: "" });

  // Setup form
  const [configForm, setConfigForm] = useState({ token: "", owner: "", repo: "", geminiKey: "" });

  useEffect(() => {
    const saved = loadConfig();
    if (saved) setConfigForm(saved);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function connect() {
    if (!configForm.token || !configForm.owner || !configForm.repo || !configForm.geminiKey) {
      setError("All fields are required."); return;
    }
    setLoading(true); setError("");
    try {
      const gh = new GitHubMemory(configForm.token, configForm.owner, configForm.repo);
      const mem = await gh.loadMemory();
      setGithub(gh); setMemory(mem); setConfig(configForm);
      setProfileForm({ name: mem.profile?.name || "", style: mem.profile?.style || "", traits: (mem.profile?.traits || []).join(", ") });
      saveConfig(configForm);
      setView("chat");
    } catch { setError("Connection failed. Check your credentials."); }
    setLoading(false);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input, ts: new Date().toISOString() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages); setInput(""); setLoading(true);
    try {
      const reply = await askAgent(input, memory, config.geminiKey);
      const agentMsg = { role: "agent", content: reply, ts: new Date().toISOString() };
      const final = [...newMessages, agentMsg];
      setMessages(final);
      const updated = { ...memory, conversations: [...(memory.conversations || []), { messages: [userMsg, agentMsg], ts: new Date().toISOString() }].slice(-100) };
      setMemory(updated);
      await github.saveMemory(updated);
    } catch (e) {
      setMessages(m => [...m, { role: "agent", content: `Error: ${e.message}`, ts: new Date().toISOString() }]);
    }
    setLoading(false);
  }

  async function addScenario() {
    if (!trainForm.situation || !trainForm.decision) { setError("Situation and decision are required."); return; }
    setLoading(true); setError("");
    const scenario = { id: `s_${Date.now()}`, situation: trainForm.situation, decision: trainForm.decision, reasoning: trainForm.reasoning, tags: trainForm.tags.split(",").map(t => t.trim()).filter(Boolean), ts: new Date().toISOString() };
    const updated = { ...memory, scenarios: [...(memory.scenarios || []), scenario] };
    const ok = await github.saveMemory(updated);
    if (ok) { setMemory(updated); setTrainForm({ situation: "", decision: "", reasoning: "", tags: "" }); setError("✅ Scenario saved! Agent updated."); }
    else setError("Failed to save. Check GitHub permissions.");
    setLoading(false);
  }

  function addTurn() { setTurns(t => [...t, { speaker: "me", message: "", myTone: "", myReaction: "" }]); }
  function updateTurn(i, field, val) { setTurns(t => t.map((turn, idx) => idx === i ? { ...turn, [field]: val } : turn)); }
  function removeTurn(i) { setTurns(t => t.filter((_, idx) => idx !== i)); }

  async function saveConvTraining() {
    const validTurns = turns.filter(t => t.message.trim());
    if (!convForm.context || validTurns.length < 1) { setError("Context and at least one message are required."); return; }
    setLoading(true); setError("");
    const entry = { id: `c_${Date.now()}`, context: convForm.context, turns: validTurns, outcome: convForm.outcome, tags: convForm.tags.split(",").map(t => t.trim()).filter(Boolean), ts: new Date().toISOString() };
    const updated = { ...memory, convTraining: [...(memory.convTraining || []), entry] };
    const ok = await github.saveMemory(updated);
    if (ok) { setMemory(updated); setConvForm({ context: "", outcome: "", tags: "" }); setTurns([{ speaker: "me", message: "", myTone: "", myReaction: "" }]); setError("✅ Conversation saved!"); }
    else setError("Failed to save.");
    setLoading(false);
  }

  async function saveProfile() {
    setLoading(true);
    const updated = { ...memory, profile: { name: profileForm.name, style: profileForm.style, traits: profileForm.traits.split(",").map(t => t.trim()).filter(Boolean) } };
    await github.saveMemory(updated); setMemory(updated); setError("✅ Profile saved to GitHub.");
    setLoading(false);
  }

  async function deleteScenario(id) {
    const updated = { ...memory, scenarios: memory.scenarios.filter(s => s.id !== id) };
    await github.saveMemory(updated); setMemory(updated);
  }

  async function deleteConv(id) {
    const updated = { ...memory, convTraining: (memory.convTraining || []).filter(c => c.id !== id) };
    await github.saveMemory(updated); setMemory(updated);
  }

  function disconnect() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setMemory(null); setGithub(null); setMessages([]); setView("setup");
  }

  // ── SETUP SCREEN ──
  if (view === "setup") return (
    <div style={S.app}>
      <div style={S.glow} />
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "80px 24px" }}>
        <div style={S.logo}>MYAGENT</div>
        <div style={S.logoSub}>Your personal AI clone — trained on your decisions and conversations. Powered by Gemini. Memory on GitHub.</div>
        {error && <div style={{...S.msg, ...(error.startsWith("✅") ? S.msgOk : S.msgErr)}}>{error}</div>}
        <div style={S.card}>
          <div style={S.cardTitle}>Connect Your Setup</div>
          <Field label="Gemini API Key" type="password" placeholder="AIzaSy..." value={configForm.geminiKey} onChange={v => setConfigForm(f => ({ ...f, geminiKey: v }))} hint="From aistudio.google.com — free, no credit card" />
          <Field label="GitHub Personal Access Token" type="password" placeholder="ghp_..." value={configForm.token} onChange={v => setConfigForm(f => ({ ...f, token: v }))} hint="Settings → Developer Settings → Tokens (classic) → repo scope" />
          <Field label="GitHub Username" placeholder="your-username" value={configForm.owner} onChange={v => setConfigForm(f => ({ ...f, owner: v }))} />
          <Field label="Memory Repo Name" placeholder="my-agent-memory" value={configForm.repo} onChange={v => setConfigForm(f => ({ ...f, repo: v }))} hint="Your private repo where memory is stored" />
          <button style={S.btn} disabled={loading} onClick={connect}>{loading ? "Connecting…" : "Connect & Launch →"}</button>
        </div>
      </div>
    </div>
  );

  const navItems = [
    { id: "chat", icon: "⚡", label: "Ask Agent" },
    { id: "train-scenario", icon: "🎯", label: "Decision Train", section: "TRAIN" },
    { id: "train-conv", icon: "💬", label: "Convo Train" },
    { id: "library", icon: "📚", label: "Library", section: "REVIEW" },
    { id: "profile", icon: "◈", label: "Profile" },
  ];

  return (
    <div style={S.app}>
      <div style={S.glow} />
      {/* SIDEBAR */}
      <div style={S.sidebar}>
        <div style={S.logo}>MYAGENT<span style={S.logoSub2}>Personal AI Clone</span></div>
        {navItems.map(n => (
          <div key={n.id}>
            {n.section && <div style={S.navSection}>{n.section}</div>}
            <div style={{ ...S.navItem, ...(view === n.id ? S.navActive : {}) }} onClick={() => { setView(n.id); setError(""); }}>
              <span>{n.icon}</span>{n.label}
            </div>
          </div>
        ))}
        <div style={S.statBox}>
          <Stat label="Decisions" value={memory?.scenarios?.length || 0} />
          <Stat label="Convos" value={memory?.convTraining?.length || 0} />
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)" }}>Agent</div>
            <div style={{ fontSize: 13, color: "#e8e4dc", marginTop: 2 }}>{memory?.profile?.name || "—"}</div>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={S.main}>

        {/* CHAT */}
        {view === "chat" && <>
          <PageHead title="Ask Your Agent" sub={`Describe any situation — ${memory?.profile?.name || "your agent"} will respond as you would.`} />
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)" }}>
            <div style={{ flex: 1, overflowY: "auto", paddingBottom: 20 }}>
              {messages.length === 0 && <Empty icon="⚡" text="Your agent is ready. Ask it any situation or scenario." />}
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 14, marginBottom: 22 }}>
                  <div style={{ ...S.avatar, ...(m.role === "agent" ? S.avatarAgent : {}) }}>{m.role === "user" ? "👤" : "⚡"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.msgMeta}>{m.role === "user" ? "You" : (memory?.profile?.name || "Agent")} · {timeAgo(m.ts)}</div>
                    <div style={{ ...S.bubble, ...(m.role === "agent" ? S.bubbleAgent : {}) }}>{m.content}</div>
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
                  <div style={{ ...S.avatar, ...S.avatarAgent }}>⚡</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.msgMeta}>Thinking…</div>
                    <div style={{ ...S.bubble, ...S.bubbleAgent }}><Dots /></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: "flex", gap: 12, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <textarea style={S.chatInput} rows={2} placeholder="'My friend said something that hurt me. How would I respond?'" value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
              <button style={{ ...S.btn, padding: "0 24px", borderRadius: 12 }} disabled={loading || !input.trim()} onClick={sendMessage}>SEND</button>
            </div>
          </div>
        </>}

        {/* DECISION TRAIN */}
        {view === "train-scenario" && <>
          <PageHead title="Decision Training" sub="Log a real situation and what you decided. Your agent learns your judgment." />
          {error && <div style={{ ...S.msg, ...(error.startsWith("✅") ? S.msgOk : S.msgErr) }}>{error}</div>}
          <div style={S.card}>
            <div style={S.cardTitle}>New Decision Scenario</div>
            <Field label="The Situation" textarea placeholder="What happened? Include full context, stakes, who was involved…" value={trainForm.situation} onChange={v => setTrainForm(f => ({ ...f, situation: v }))} />
            <Field label="Your Decision / What You Did" placeholder="I decided to…" value={trainForm.decision} onChange={v => setTrainForm(f => ({ ...f, decision: v }))} />
            <Field label="Your Reasoning (optional but powerful)" textarea placeholder="Why? What factors mattered most?" value={trainForm.reasoning} onChange={v => setTrainForm(f => ({ ...f, reasoning: v }))} />
            <Field label="Tags (comma separated)" placeholder="work, money, relationships…" value={trainForm.tags} onChange={v => setTrainForm(f => ({ ...f, tags: v }))} />
            <button style={S.btn} disabled={loading} onClick={addScenario}>{loading ? "Saving…" : "Save & Train Agent →"}</button>
          </div>
        </>}

        {/* CONVO TRAIN */}
        {view === "train-conv" && <>
          <PageHead title="Conversation Training" sub="Log a real conversation turn by turn — your tone, reaction, what you said. Teaches your agent your social patterns." />
          {error && <div style={{ ...S.msg, ...(error.startsWith("✅") ? S.msgOk : S.msgErr) }}>{error}</div>}
          <div style={S.card}>
            <div style={S.cardTitle}>Context</div>
            <Field label="What was this about?" placeholder="e.g. My boss criticised my work in front of the team" value={convForm.context} onChange={v => setConvForm(f => ({ ...f, context: v }))} />
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Turn by Turn</div>
            {turns.map((turn, i) => (
              <div key={i} style={{ ...S.turnBlock, ...(turn.speaker === "me" ? S.turnBlockMe : {}) }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={S.turnNum}>Turn {i + 1}</span>
                  <select style={S.select} value={turn.speaker} onChange={e => updateTurn(i, "speaker", e.target.value)}>
                    {SPEAKERS.map(s => <option key={s} value={s.toLowerCase()}>{s}</option>)}
                  </select>
                  {turns.length > 1 && <button style={{ ...S.btnGhost, ...S.btnSm, color: "#ff7070", borderColor: "rgba(255,80,80,0.2)" }} onClick={() => removeTurn(i)}>Remove</button>}
                </div>
                <Field label={turn.speaker === "me" ? "What I said / did" : "What they said"} textarea placeholder={turn.speaker === "me" ? "Exactly what I said or how I reacted…" : "What they said to me…"} value={turn.message} onChange={v => updateTurn(i, "message", v)} />
                {turn.speaker === "me" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={S.fieldLabel}>My Tone</div>
                      <select style={S.select} value={turn.myTone} onChange={e => updateTurn(i, "myTone", e.target.value)}>
                        <option value="">Select…</option>
                        {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <Field label="My Inner Reaction" placeholder="What I actually felt…" value={turn.myReaction} onChange={v => updateTurn(i, "myReaction", v)} />
                  </div>
                )}
              </div>
            ))}
            <button style={{ ...S.btnGhost, ...S.btnSm, marginBottom: 4 }} onClick={addTurn}>+ Add Turn</button>
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Wrap Up</div>
            <Field label="Outcome" placeholder="We resolved it / I walked away / They apologised…" value={convForm.outcome} onChange={v => setConvForm(f => ({ ...f, outcome: v }))} />
            <Field label="Tags" placeholder="conflict, work, family…" value={convForm.tags} onChange={v => setConvForm(f => ({ ...f, tags: v }))} />
            <button style={S.btn} disabled={loading} onClick={saveConvTraining}>{loading ? "Saving…" : "Save Conversation →"}</button>
          </div>
        </>}

        {/* LIBRARY */}
        {view === "library" && <>
          <PageHead title="Training Library" sub="Everything your agent has learned from you." />
          <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 4 }}>
            {["decisions", "conversations"].map(t => (
              <div key={t} style={{ ...S.tab, ...(libTab === t ? S.tabActive : {}) }} onClick={() => setLibTab(t)}>
                {t === "decisions" ? `🎯 Decisions (${memory?.scenarios?.length || 0})` : `💬 Conversations (${memory?.convTraining?.length || 0})`}
              </div>
            ))}
          </div>
          {libTab === "decisions" && (
            (!memory?.scenarios?.length)
              ? <Empty icon="🎯" text="No decisions logged yet. Start training from Decision Train." />
              : [...(memory.scenarios || [])].reverse().map(s => (
                <div key={s.id} style={S.libCard}>
                  <Label>Situation</Label><div style={S.libText}>{s.situation}</div>
                  <Label>Decision</Label><div style={{ ...S.libText, color: "#63ffb4", fontWeight: 700 }}>{s.decision}</div>
                  {s.reasoning && <><Label>Reasoning</Label><div style={{ ...S.libText, color: "rgba(255,255,255,0.5)" }}>{s.reasoning}</div></>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{(s.tags || []).map(t => <span key={t} style={S.tag}>{t}</span>)}<span style={S.timeText}>{timeAgo(s.ts)}</span></div>
                    <button style={S.delBtn} onClick={() => deleteScenario(s.id)}>✕</button>
                  </div>
                </div>
              ))
          )}
          {libTab === "conversations" && (
            (!memory?.convTraining?.length)
              ? <Empty icon="💬" text="No conversations logged yet. Start training from Convo Train." />
              : [...(memory.convTraining || [])].reverse().map(c => (
                <div key={c.id} style={S.libCard}>
                  <Label>Context</Label><div style={{ ...S.libText, fontWeight: 700 }}>{c.context}</div>
                  <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: "10px 0" }} />
                  {c.turns.map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                      <span style={{ ...S.badge, ...(t.speaker === "me" ? S.badgeMe : S.badgeOther) }}>{t.speaker}</span>
                      <div>
                        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>{t.message}</div>
                        {(t.myTone || t.myReaction) && <div style={{ fontSize: 11, color: "rgba(255,180,80,0.7)", marginTop: 2 }}>{t.myTone && `[${t.myTone}]`} {t.myReaction && `"${t.myReaction}"`}</div>}
                      </div>
                    </div>
                  ))}
                  {c.outcome && <><hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: "10px 0" }} /><Label>Outcome</Label><div style={{ ...S.libText, color: "rgba(255,255,255,0.5)" }}>{c.outcome}</div></>}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{(c.tags || []).map(t => <span key={t} style={S.tag}>{t}</span>)}<span style={S.timeText}>{timeAgo(c.ts)}</span></div>
                    <button style={S.delBtn} onClick={() => deleteConv(c.id)}>✕</button>
                  </div>
                </div>
              ))
          )}
        </>}

        {/* PROFILE */}
        {view === "profile" && <>
          <PageHead title="Agent Profile" sub="Define who you are — shapes every response your agent gives." />
          {error && <div style={{ ...S.msg, ...(error.startsWith("✅") ? S.msgOk : S.msgErr) }}>{error}</div>}
          <div style={S.card}>
            <div style={S.cardTitle}>Your Identity</div>
            <Field label="Your Name" placeholder="What should the agent call itself?" value={profileForm.name} onChange={v => setProfileForm(f => ({ ...f, name: v }))} />
            <Field label="Your Communication Style" textarea placeholder="How do you talk? Direct? Measured? Blunt? Describe your voice and energy…" value={profileForm.style} onChange={v => setProfileForm(f => ({ ...f, style: v }))} />
            <Field label="Your Core Traits (comma separated)" placeholder="ambitious, loyal, blunt, analytical…" value={profileForm.traits} onChange={v => setProfileForm(f => ({ ...f, traits: v }))} />
            <button style={S.btn} disabled={loading} onClick={saveProfile}>{loading ? "Saving…" : "Save Profile to GitHub →"}</button>
          </div>
          <div style={S.card}>
            <div style={S.cardTitle}>Connection</div>
            <div style={{ fontFamily: "monospace", fontSize: 13, color: "#63ffb4", marginBottom: 6 }}>{config.owner}/{config.repo}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>Memory: agent-memory/memory.json</div>
            <button style={{ ...S.btnGhost, ...S.btnSm }} onClick={disconnect}>Disconnect</button>
          </div>
        </>}

      </div>
    </div>
  );
}

// ── SMALL COMPONENTS ──
function Field({ label, placeholder, value, onChange, textarea, type, hint }) {
  const style = { width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "11px 14px", color: "#e8e4dc", fontFamily: "inherit", fontSize: 13, outline: "none", resize: textarea ? "vertical" : undefined, minHeight: textarea ? 80 : undefined };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={S.fieldLabel}>{label}</div>
      {textarea
        ? <textarea style={style} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
        : <input style={style} type={type || "text"} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />}
      {hint && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 5 }}>{hint}</div>}
    </div>
  );
}
function PageHead({ title, sub }) {
  return <><div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6, letterSpacing: "-0.02em" }}>{title}</div><div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 28 }}>{sub}</div></>;
}
function Stat({ label, value }) {
  return <div style={{ marginBottom: 10 }}><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)" }}>{label}</div><div style={{ fontSize: 20, fontWeight: 800, color: "#63ffb4", fontFamily: "monospace" }}>{value}</div></div>;
}
function Empty({ icon, text }) {
  return <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.3)" }}><div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div><p style={{ fontSize: 14 }}>{text}</p></div>;
}
function Label({ children }) {
  return <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>{children}</div>;
}
function Dots() {
  return <div style={{ display: "flex", gap: 5 }}>{[0, 200, 400].map(d => <div key={d} style={{ width: 6, height: 6, background: "#63ffb4", borderRadius: "50%", animation: `bounce 1.2s ${d}ms infinite` }} />)}</div>;
}

// ── STYLES ──
const S = {
  app: { fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#0a0a0f", minHeight: "100vh", color: "#e8e4dc" },
  glow: { position: "fixed", pointerEvents: "none", zIndex: 0, width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,255,180,0.04) 0%, transparent 70%)", top: -200, right: -200 },
  sidebar: { position: "fixed", left: 0, top: 0, bottom: 0, width: 220, background: "rgba(255,255,255,0.02)", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", zIndex: 10, padding: "28px 0" },
  logo: { padding: "0 24px 28px", fontSize: 14, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "#63ffb4" },
  logoSub: { fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 36, lineHeight: 1.6 },
  logoSub2: { display: "block", fontWeight: 400, color: "rgba(255,255,255,0.3)", fontSize: 10, marginTop: 2, letterSpacing: "0.08em" },
  navSection: { padding: "8px 24px 4px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.15em", color: "rgba(255,255,255,0.2)", marginTop: 8 },
  navItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 24px", cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", color: "rgba(255,255,255,0.4)", borderLeft: "2px solid transparent", textTransform: "uppercase" },
  navActive: { color: "#63ffb4", borderLeftColor: "#63ffb4", background: "rgba(99,255,180,0.04)" },
  statBox: { marginTop: "auto", padding: 24, borderTop: "1px solid rgba(255,255,255,0.06)" },
  main: { marginLeft: 220, minHeight: "100vh", padding: 40, position: "relative", zIndex: 1 },
  card: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 24, marginBottom: 18 },
  cardTitle: { fontSize: 14, fontWeight: 700, marginBottom: 18, letterSpacing: "0.02em" },
  fieldLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", marginBottom: 7 },
  btn: { background: "#63ffb4", color: "#0a0a0f", border: "none", borderRadius: 10, padding: "12px 22px", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer", width: "100%", letterSpacing: "0.05em" },
  btnGhost: { background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", borderRadius: 10, padding: "11px 22px", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  btnSm: { padding: "7px 14px", fontSize: 11, borderRadius: 8 },
  msg: { fontSize: 13, padding: "11px 14px", borderRadius: 8, marginBottom: 14 },
  msgErr: { background: "rgba(255,100,100,0.08)", border: "1px solid rgba(255,100,100,0.2)", color: "#ff9090" },
  msgOk: { background: "rgba(99,255,180,0.08)", border: "1px solid rgba(99,255,180,0.2)", color: "#63ffb4" },
  avatar: { width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0, marginTop: 2, background: "rgba(255,255,255,0.08)" },
  avatarAgent: { background: "rgba(99,255,180,0.12)" },
  msgMeta: { fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 6, fontFamily: "monospace" },
  bubble: { fontSize: 14, lineHeight: 1.7, color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 18px", whiteSpace: "pre-wrap" },
  bubbleAgent: { background: "rgba(99,255,180,0.04)", borderColor: "rgba(99,255,180,0.1)" },
  chatInput: { flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 18px", color: "#e8e4dc", fontFamily: "inherit", fontSize: 14, outline: "none", resize: "none" },
  turnBlock: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16, marginBottom: 12 },
  turnBlockMe: { borderColor: "rgba(99,255,180,0.12)", background: "rgba(99,255,180,0.02)" },
  turnNum: { fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", padding: "3px 8px", borderRadius: 4 },
  select: { width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 14px", color: "#e8e4dc", fontFamily: "inherit", fontSize: 13, outline: "none" },
  libCard: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 18, marginBottom: 12 },
  libText: { fontSize: 13, lineHeight: 1.6, marginBottom: 10 },
  tab: { padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" },
  tabActive: { background: "rgba(99,255,180,0.1)", color: "#63ffb4" },
  tag: { background: "rgba(255,255,255,0.06)", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "rgba(255,255,255,0.4)" },
  timeText: { fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" },
  delBtn: { background: "none", border: "none", cursor: "pointer", color: "rgba(255,100,100,0.3)", fontSize: 15, padding: 4 },
  badge: { fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.05em" },
  badgeMe: { background: "rgba(99,255,180,0.15)", color: "#63ffb4" },
  badgeOther: { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" },
};

const styleTag = document.createElement("style");
styleTag.textContent = `@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} } * { box-sizing: border-box; } body { margin: 0; } select option { background: #1a1a2e; }`;
document.head.appendChild(styleTag);
