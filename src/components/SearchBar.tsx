interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function SearchBar({ value, onChange }: Props) {
  return (
    <input
      type="search"
      placeholder="Search transcript…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="search"
    />
  );
}
