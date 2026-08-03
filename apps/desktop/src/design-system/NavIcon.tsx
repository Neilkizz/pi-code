export type NavIconName =
  | "chat"
  | "sliders"
  | "puzzle"
  | "activity"
  | "folder"
  | "settings"
  | "trash"
  | "book"
  | "plug"
  | "chevron-down"
  | "arrow-up"
  | "stop";

const paths: Record<NavIconName, string> = {
  chat: "M4 5.75A2.75 2.75 0 0 1 6.75 3h10.5A2.75 2.75 0 0 1 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H10l-4.6 3.2A.9.9 0 0 1 4 18.46V5.75Z",
  plug: "M12 3v5M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8Zm5 8v5",
  book: "M4 4.5A1.5 1.5 0 0 1 5.5 3h13A1.5 1.5 0 0 1 20 4.5v15A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-15ZM6 5v14h12V5H6Zm2 3h8v1.5H8V8Zm0 4h8v1.5H8V12Z",
  sliders: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6",
  puzzle:
    "M8.5 4H5a1 1 0 0 0-1 1v3.5a2.5 2.5 0 1 1 0 5V17a1 1 0 0 0 1 1h3.5a2.5 2.5 0 1 0 5 0H17a1 1 0 0 0 1-1v-3.5a2.5 2.5 0 1 0 0-5V5a1 1 0 0 0-1-1h-3.5a2.5 2.5 0 1 1-5 0Z",
  activity: "M4 12h3l2-6 4 12 2-6h5",
  folder:
    "M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-10Z",
  settings:
    "M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Zm7.1 5.2.9.7-2 3.46-1.03-.43a7.6 7.6 0 0 1-1.55.9l-.14 1.1h-4l-.14-1.1a7.6 7.6 0 0 1-1.55-.9l-1.03.43-2-3.46.9-.7a7.8 7.8 0 0 1 0-1.9l-.9-.7 2-3.46 1.03.43a7.6 7.6 0 0 1 1.55-.9l.14-1.1h4l.14 1.1a7.6 7.6 0 0 1 1.55.9L18 6.89l2 3.46-.9.7a7.8 7.8 0 0 1 0 1.9Z",
  trash:
    "M6 7h12M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-8 0 1 11a1.5 1.5 0 0 0 1.5 1.4h5A1.5 1.5 0 0 0 16 18l1-11M10 11v5M14 11v5",
  "chevron-down": "M6 9l6 6 6-6",
  "arrow-up": "M12 19V5M5 12l7-7 7 7",
  stop: "M6 6h12v12H6z",
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={paths[name]} />
    </svg>
  );
}
