-- Reintroduz a coluna disposto removida na 0018 por engano.
ALTER TABLE lead_qualification ADD COLUMN disposto TEXT;
