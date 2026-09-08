# Local fixtures

This folder is gitignored. Drop real-world PDFs here to test against them:
files from Word, InDesign, LaTeX, a scanner, DocuSign, Adobe Sign.

Real documents are not committed. They are other people's data, and a test
corpus in version control is the wrong place for it. The tests treat whatever
is here as an optional extra corpus and skip cleanly when the folder is empty.
