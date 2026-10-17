// packetIndex.js — turns the raw packet into lookup tables.
//
// Everything else in the app asks this index instead of scanning arrays.
// Built once in main.js after loadPacket.js returns the JSON.
//
//   documents   Map  D08            -> document record
//   values      Map  ev-0016        -> extracted value
//   versions[]  each return version plus byKey (line key -> line)
//                                   and feeds (line key -> lines that use it as an input)
//   current     the latest version (v3), the one the app shows
//   landed      Map  ev-0016        -> line keys in the current version that cite it

function push(map, key, item) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

function buildVersion(version) {
  const byKey = new Map();
  const feeds = new Map();
  for (const line of version.lines) byKey.set(line.key, line);
  for (const line of version.lines) {
    for (const input of line.inputs ?? []) push(feeds, input, line.key);
  }
  return { ...version, byKey, feeds };
}

export function buildIndex(packet) {
  const documents = new Map(packet.documents.map((doc) => [doc.id, doc]));
  const values = new Map(packet.extracted_values.map((value) => [value.id, value]));

  const valuesByDoc = new Map();
  for (const value of packet.extracted_values) push(valuesByDoc, value.document_id, value);

  const versions = packet.return_versions.map(buildVersion);
  const current = versions[versions.length - 1];

  const landed = new Map();
  for (const line of current.lines) {
    for (const ref of line.sources ?? []) push(landed, ref, line.key);
  }

  return { packet, documents, values, valuesByDoc, versions, current, landed };
}

/**
 * Where did a document land in the current return?
 * Returns { keys: [line keys], note: plain-language reason when there are none }.
 * This answers the brief's "any document to everywhere it landed (or why it didn't)".
 */
export function docLanding(index, docId) {
  const keys = new Set();
  for (const value of index.valuesByDoc.get(docId) ?? []) {
    for (const key of index.landed.get(value.id) ?? []) keys.add(key);
  }
  const doc = index.documents.get(docId);
  const { documents_used = [], documents_superseded = [] } = index.current;

  let note = '';
  if (keys.size === 0) {
    if (documents_superseded.includes(docId)) {
      note = 'Superseded by a corrected document. The engine no longer uses it.';
    } else if (doc?.extraction?.status === 'not_extracted') {
      note = `Not read by the pipeline. ${doc.extraction.reason ?? ''}`.trim();
    } else if (!documents_used.includes(docId)) {
      note = 'Not used by the engine in the current version.';
    } else {
      note = 'Used by the engine, but no line cites its values directly.';
    }
  }
  return { keys: [...keys], note };
}
