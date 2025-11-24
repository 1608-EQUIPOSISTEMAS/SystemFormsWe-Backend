export const safe = (value) => 
  (value === null || value === undefined ? '' : value)

export const createHyperlink = (url, text) => 
  url ? `=HYPERLINK("${url}";"${text}")` : ''