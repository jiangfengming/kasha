/* eslint no-control-regex: "off" */

// https://www.ryadel.com/en/javascript-remove-xml-invalid-chars-characters-string-utf8-unicode-regex/

function removeXMLInvalidChars(string, removeDiscouragedChars = true) {
  // remove everything forbidden by XML 1.0 specifications, plus the unicode replacement character U+FFFD
  let regex = /([^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFC\u{10000}-\u{10FFFF}])/ug
  string = string.replace(regex, '')

  if (removeDiscouragedChars) {
    // remove everything not suggested by XML 1.0 specifications
    regex = /([\x7F-\x84]|[\x86-\x9F]|[\uFDD0-\uFDEF]|[\u{1FFFE}-\u{1FFFF}]|[\u{2FFFE}-\u{2FFFF}]|[\u{3FFFE}-\u{3FFFF}]|[\u{4FFFE}-\u{4FFFF}]|[\u{5FFFE}-\u{5FFFF}]|[\u{6FFFE}-\u{6FFFF}]|[\u{7FFFE}-\u{7FFFF}]|[\u{8FFFE}-\u{8FFFF}]|[\u{9FFFE}-\u{9FFFF}]|[\u{AFFFE}-\u{AFFFF}]|[\u{BFFFE}-\u{BFFFF}]|[\u{CFFFE}-\u{CFFFF}]|[\u{DFFFE}-\u{DFFFF}]|[\u{EFFFE}-\u{EFFFF}]|[\u{FFFFE}-\u{FFFFF}]|[\u{10FFFE}-\u{10FFFF}].)/ug
    string = string.replace(regex, '')
  }

  return string
}

module.exports = removeXMLInvalidChars
