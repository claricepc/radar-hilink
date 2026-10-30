-- 30/10/2026 - Segurança das tabelas de premiação e perfil ativo
-- Pedido: revisão do Codex (T01, T02). Aprovado por Clarice.

-- ===== CONFIGURAÇÃO ANTERIOR (para desfazer) =====
-- public.prem_overrides:  RLS ligado; policy "Acesso público radar"       FOR ALL TO public USING (true) WITH CHECK (true)
-- public.prem_fechamentos: RLS ligado; policy "Acesso público fechamentos" FOR ALL TO public USING (true) WITH CHECK (true)
-- grants: anon e authenticated com SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER nas duas tabelas
-- public.radar_perfil():
--   select case when public.radar_eh_admin() then 'admin'
--     else coalesce((select lower(perfil) from public.radar_usuarios where lower(email) = lower(auth.jwt()->>'email')), 'usuario') end
-- Para desfazer: recriar as duas policies acima, "grant all on ... to anon, authenticated" e a função antiga.

-- ===== NOVA CONFIGURAÇÃO =====
create or replace function public.radar_perfil()
 returns text language sql stable security definer set search_path to 'ixc','public','pg_temp'
as $$
  select case when public.radar_eh_admin() then 'admin'
    else coalesce((select lower(perfil) from public.radar_usuarios
                   where lower(email) = lower(auth.jwt()->>'email') and status = 'ativo'), 'atendente') end
$$;
-- Quem não está ativo (ou não está cadastrado) recebe o perfil mais restrito existente: atendente.

revoke all on public.prem_overrides, public.prem_fechamentos from anon;
revoke all on public.prem_overrides, public.prem_fechamentos from authenticated;
grant select, insert, update, delete on public.prem_overrides, public.prem_fechamentos to authenticated;

drop policy if exists "Acesso público radar" on public.prem_overrides;
drop policy if exists "Acesso público fechamentos" on public.prem_fechamentos;

create policy prem_ov_gestao_lideranca on public.prem_overrides for all to authenticated
  using (public.radar_perfil() in ('admin','lider'))
  with check (public.radar_perfil() in ('admin','lider'));

create policy prem_fech_ler on public.prem_fechamentos for select to authenticated
  using (public.radar_perfil() in ('admin','lider'));
create policy prem_fech_gestao_inserir on public.prem_fechamentos for insert to authenticated
  with check (public.radar_perfil() = 'admin');
create policy prem_fech_gestao_alterar on public.prem_fechamentos for update to authenticated
  using (public.radar_perfil() = 'admin') with check (public.radar_perfil() = 'admin');
create policy prem_fech_gestao_excluir on public.prem_fechamentos for delete to authenticated
  using (public.radar_perfil() = 'admin');
