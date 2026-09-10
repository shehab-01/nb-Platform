/** The 404 page for both hosts: a hostname no store answers on, or a path
 * that does not exist. Deliberately says nothing about the platform. */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#334155",
        background: "#f8fafc",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 40, fontWeight: 700, margin: 0 }}>404</p>
        <p style={{ margin: "8px 0 0" }}>Nothing here.</p>
      </div>
    </main>
  );
}
