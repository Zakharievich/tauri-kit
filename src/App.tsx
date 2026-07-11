import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./App.css";

// Route-level code splitting: only JoinPage is needed at startup. RoomPage
// pulls in the heavy livekit-client + @livekit/components-react stack, so
// keeping it in its own chunk means the initial screen loads and parses
// without that weight.
const JoinPage = lazy(() =>
  import("./pages/JoinPage").then((m) => ({ default: m.JoinPage })),
);
const RoomPage = lazy(() =>
  import("./pages/RoomPage").then((m) => ({ default: m.RoomPage })),
);
const TranscriptPage = lazy(() =>
  import("./pages/TranscriptPage").then((m) => ({ default: m.TranscriptPage })),
);

function App() {
  return (
    <Suspense
      fallback={
        <main className="room-page room-page__status">
          <p>Загрузка…</p>
        </main>
      }
    >
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/room" element={<RoomPage />} />
        <Route path="/transcript" element={<TranscriptPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}


export default App;
