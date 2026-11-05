-- A revision conflict is permanent for this request, not a serialization retry.
-- Preserve the existing function's identity, grants, locks and validation.
do $migration$
declare definition text; conflicts integer;
begin
  definition := pg_get_functiondef('public.wirenexus_collaboration(text,jsonb)'::regprocedure);
  conflicts := (length(definition)-length(replace(definition,'''40001''','')))/7;
  if conflicts <> 5 then
    raise exception 'Unexpected collaboration conflict guards; review migration before applying';
  end if;
  execute replace(definition,'''40001''','''PT409''');
end
$migration$;
