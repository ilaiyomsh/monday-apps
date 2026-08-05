function OptionChecklist({ options, values, disabled, onChange, emptyText }) {
  const selected = new Set((values ?? []).map(String));
  if (!options.length) {
    return <p className="twyst-field-empty">{emptyText}</p>;
  }
  return (
    <div className="twyst-check-list" role="group">
      {options.map((option) => {
        const id = String(option.id);
        return (
          <label key={id} className="twyst-check-row">
            <input
              type="checkbox"
              checked={selected.has(id)}
              disabled={disabled || option.disabled}
              onChange={() => {
                const next = new Set(selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                onChange([...next]);
              }}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export default OptionChecklist;
