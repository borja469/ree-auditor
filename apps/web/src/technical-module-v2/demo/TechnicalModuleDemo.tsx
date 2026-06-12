import type { TechnicalModuleDemoView } from "./types.js";

export function TechnicalModuleDemo({ view }: { view: TechnicalModuleDemoView }) {
  return (
    <section>
      <header>
        <h2>TechnicalModuleV2 Demo</h2>
        <p>{"Rows -> Filters -> Sort -> Visible Columns -> Render simple"}</p>
      </header>
      <table>
        <thead>
          <tr>
            {view.visibleColumns.map((column) => (
              <th key={column.id}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.renderedRows.map((row, index) => (
            <tr key={index}>
              {view.visibleColumns.map((column) => (
                <td key={column.id}>{row[column.id]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
