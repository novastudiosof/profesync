-- ProfeSync — el usuario puede llevar mayúsculas, pero no puede repetirse sin importarlas.
-- Ejecutar después de 001-007. Idempotente. Recomendado (la app ya valida esto, esto lo asegura en la base).
create unique index if not exists profiles_username_lower_uq on profiles (lower(username));
