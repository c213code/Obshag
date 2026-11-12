-- Slice 21: the group purchase post carries a «💸 <имя> → перевести» url button per debtor (one pay link each, as in remind).
-- 0001-0018 are live and untouched. Only private.tg_on_purchase (0007) is replaced; its deferred constraint trigger stays.

create or replace function private.tg_on_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat bigint;
  v_new boolean;
  v_text text;
  v_rows jsonb;
  v_d record;
  v_code text;
begin
  begin
    if new.status = 'shared' and (tg_op = 'INSERT' or old.status = 'pending') then
      select h.telegram_chat_id into v_chat from public.households h where h.id = new.household_id;
      if v_chat is not null then
        insert into private.telegram_sent (kind, ref) values ('purchase', new.id) on conflict do nothing;
        get diagnostics v_new = row_count;
        if v_new then
          v_text := private.tg_purchase_message(new.id);
          begin
            -- one row per debtor, same order as the «Должны» lines; the sub-block rolls the links back on any error
            v_rows := '[]'::jsonb;
            for v_d in
              select s.debtor_id, left(pr.display_name, 30) as name
              from public.shares s
              join public.profiles pr on pr.id = s.debtor_id
              join public.members m on m.household_id = new.household_id and m.user_id = s.debtor_id and m.active
              where s.purchase_id = new.id and s.debtor_id <> new.payer_id and s.amount > 0 and s.settled_at is null
              order by s.debtor_id
            loop
              v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_');
              insert into public.pay_links (code, household_id, from_user, to_user)
                values (v_code, new.household_id, v_d.debtor_id, new.payer_id);
              v_rows := v_rows || jsonb_build_array(jsonb_build_array(jsonb_build_object(
                'text', '💸 ' || v_d.name || ' → перевести',
                'url', private.app_url() || '/k/' || v_code
              )));
            end loop;
            if jsonb_array_length(v_rows) = 0 then
              perform private.tg_send(v_chat, v_text);
            else
              perform private.tg_send_markup(v_chat, v_text, jsonb_build_object('inline_keyboard', v_rows));
            end if;
          exception when others then
            perform private.tg_send(v_chat, v_text); -- no links: the plain post
          end;
        end if;
      end if;
    end if;
  exception when others then
    null; -- never break the user's transaction
  end;
  return null;
end;
$$;
revoke all on function private.tg_on_purchase() from public, anon, authenticated;
