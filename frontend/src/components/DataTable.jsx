import { Fragment } from 'react';

export default function DataTable({ columns, rows, ctx, expanded, renderExpanded }) {
  // Position is part of the key so two columns with the same (or an empty) label never collide.
  const colKey = (c, i) => `${c.key || c.label || 'col'}-${i}`;

  return (
    <div className="tw">
      <table>
        <thead>
          <tr>{columns.map((c, i) => <th key={colKey(c, i)} className={c.className}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr>
                {columns.map((c, i) => (
                  <td key={colKey(c, i)} className={c.className} data-label={c.label}>{c.render ? c.render(r, ctx) : r[c.key]}</td>
                ))}
              </tr>
              {expanded === r.id && renderExpanded && (
                <tr className="expand"><td colSpan={columns.length}>{renderExpanded(r, ctx)}</td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}