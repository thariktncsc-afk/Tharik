/**
 * Placeholder body for routes whose screen has not been converted yet.
 * The legacy app at `/` remains fully functional throughout the conversion,
 * so each stub points there until its React version ships.
 */
export default function UnderConversion({ title }: { title: string }) {
  return (
    <div className="page active">
      <div
        className="card"
        style={{ maxWidth: 560, margin: '48px auto', padding: '40px 32px', textAlign: 'center' }}
      >
        <div style={{ fontSize: 42, marginBottom: 12 }}>🚧</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{title} — coming to the new interface</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 20px' }}>
          This screen is being converted page by page. Until it lands here, everything keeps working
          in the classic app — same data, same sign-in.
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            background: '#0369A1',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            padding: '10px 22px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Open the classic app
        </a>
      </div>
    </div>
  );
}
