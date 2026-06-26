// Foundation stand-in for a data view. The Screens agent replaces each routed
// <Placeholder/> with the real screen (see SCREENS_API.md).
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="placeholder">
      <div className="inner">
        <div className="pt">{title}</div>
        <div className="pm">
          Foundation ready
          <br />
          this screen is wired by the Screens agent
        </div>
      </div>
    </div>
  );
}
