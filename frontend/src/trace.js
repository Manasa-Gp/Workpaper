// trace.js — follows a number back to its evidence, and forward to what uses it.
//
// Called by: views/claim.js (to build the evidence trail) and main.js (to compute statuses).
// Uses:      packetIndex.js tables.
//
// A line's `sources` can point at many kinds of evidence. resolveSource() turns each
// reference string into a small object with a `kind`, so the views never parse strings:
//
//   ev-0016            -> { kind: 'value',  value, doc }       a value read from a document
//   qa-14 / msg-07 ... -> { kind: 'client', item }              something the client said
//   py:/return_2024/.. -> { kind: 'prior',  pointer, found }    last year's records
//   agency:/...        -> { kind: 'agency', pointer, found }    IRS / FTB records
//   ref:param.x        -> { kind: 'param',  name, found }       an engine parameter
//   asset:SAC-APPL     -> { kind: 'asset',  record }            a depreciable asset
//   household:ngozi    -> { kind: 'person', person }
//   timeline:tl-20     -> { kind: 'event',  event }
//   doc:D30#page32     -> { kind: 'unread', doc, page }         a page the pipeline never read

export function traceClaim(index, key) {
  const line = index.current.byKey.get(key);
  if (!line) return null;
  const inputs = (line.inputs ?? []).map((k) => index.current.byKey.get(k)).filter(Boolean);
  const feeds = (index.current.feeds.get(key) ?? []).map((k) => index.current.byKey.get(k)).filter(Boolean);
  const sources = (line.sources ?? []).map((ref) => resolveSource(index, ref));
  return { line, inputs, feeds, sources };
}

export function resolveSource(index, ref) {
  const { packet } = index;

  if (ref.startsWith('ev-')) {
    const value = index.values.get(ref);
    return { ref, kind: 'value', value, doc: value ? index.documents.get(value.document_id) : null };
  }
  if (ref.startsWith('qa-')) {
    return { ref, kind: 'client', type: 'Questionnaire', item: packet.client.questionnaire.find((q) => q.id === ref) };
  }
  if (ref.startsWith('msg-')) {
    return { ref, kind: 'client', type: 'Message', item: packet.client.messages.find((m) => m.id === ref) };
  }
  if (ref.startsWith('call-')) {
    return { ref, kind: 'client', type: 'Call notes', item: packet.client.call_notes.find((c) => c.id === ref) };
  }
  if (ref.startsWith('py:')) {
    const pointer = ref.slice(3);
    return { ref, kind: 'prior', pointer, found: resolvePointer(packet.prior_years, pointer) };
  }
  if (ref.startsWith('agency:')) {
    const pointer = ref.slice(7);
    return { ref, kind: 'agency', pointer, found: resolvePointer(packet.tax_agency_records, pointer) };
  }
  if (ref.startsWith('ref:param.')) {
    const name = ref.slice('ref:param.'.length);
    return { ref, kind: 'param', name, found: packet.engine_reference.parameters[name] };
  }
  if (ref.startsWith('asset:')) {
    const id = ref.slice(6);
    const record =
      (index.current.assets ?? []).find((a) => a.asset_id === id) ??
      (packet.prior_years.asset_records ?? []).find((a) => a.asset_id === id);
    return { ref, kind: 'asset', id, record };
  }
  if (ref.startsWith('household:')) {
    const id = ref.slice('household:'.length);
    return { ref, kind: 'person', person: packet.household.people.find((p) => p.id === id) };
  }
  if (ref.startsWith('timeline:')) {
    const id = ref.slice('timeline:'.length);
    return { ref, kind: 'event', event: packet.timeline.find((t) => t.id === id) };
  }
  if (ref.startsWith('doc:')) {
    const [docId, pageText] = ref.slice(4).split('#page');
    return { ref, kind: 'unread', doc: index.documents.get(docId), page: Number(pageText) };
  }
  return { ref, kind: 'other' };
}

/** RFC 6901 JSON Pointer, e.g. "/return_2024/lines/F8606.14". */
export function resolvePointer(root, pointer) {
  let node = root;
  for (const raw of pointer.split('/').slice(1)) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || node === undefined) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * The "locator" is the contract between a number and a document view.
 * A real PDF viewer needs exactly these fields to draw a box on the right page.
 * The simulated viewer (views/source.js) needs the same fields to place a highlight.
 */
export function locatorFor(value) {
  return {
    documentId: value.document_id,
    page: value.page,
    field: value.field,
    label: value.label,
    textAsRead: value.text_as_read,
    position: value.position, // synthetic in this packet; real once extraction supplies it
  };
}
