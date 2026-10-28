-- LKZ ISP v1.2: remetente de e-mails exclusivamente Resend, sem chaves neste repositório.
-- Escopo: projeto LKZ ISP syysqoieyycclpfbadwp. Não executar em outro projeto.
-- Atenção: esta migração REBLOQUEIA o envio; ativação somente após SMTP/DNS homologados.
BEGIN;
UPDATE lkz_private.lkz_isp_invitation_mailer
 SET enabled=false,configured_at=NULL WHERE singleton=true;
ALTER TABLE lkz_private.lkz_isp_invitation_mailer
 DROP CONSTRAINT lkz_isp_invitation_mailer_sender_email_check;
UPDATE lkz_private.lkz_isp_invitation_mailer
 SET sender_email='convites@lacrosetecnologia.com.br' WHERE singleton=true;
ALTER TABLE lkz_private.lkz_isp_invitation_mailer
 ADD CONSTRAINT lkz_isp_invitation_mailer_sender_email_check
 CHECK (sender_email='convites@lacrosetecnologia.com.br');
CREATE OR REPLACE FUNCTION public.lkz_isp_internal_claim_invite_delivery(p_invitation uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE inv record; cfg record; n integer;
BEGIN
 SELECT * INTO cfg FROM lkz_private.lkz_isp_invitation_mailer WHERE singleton=true;
 IF cfg.enabled IS DISTINCT FROM true OR cfg.sender_email<>'convites@lacrosetecnologia.com.br' THEN
   RAISE EXCEPTION 'RESEND_SMTP_NOT_CONFIGURED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO inv FROM public.lkz_isp_user_invitations
 WHERE id=p_invitation FOR UPDATE;
 IF NOT FOUND OR inv.created_by<>p_actor OR inv.status<>'pending'
   OR inv.expires_at<=now()
   OR NOT lkz_private.lkz_isp_authorized_inviter(p_actor,inv.tenant_id,inv.requested_role) THEN
   RAISE EXCEPTION 'INVITATION_NOT_AUTHORIZED_OR_EXPIRED' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO n FROM public.lkz_isp_user_invitations
 WHERE created_by=p_actor AND status IN ('sending','sent','accepted')
 AND last_delivery_attempt_at>now()-interval '1 hour';
 IF n>=10 OR inv.send_attempts>=5 THEN
   RAISE EXCEPTION 'INVITE_RATE_LIMIT' USING ERRCODE='42501';
 END IF;
 UPDATE public.lkz_isp_user_invitations
 SET status='sending',send_attempts=send_attempts+1,last_delivery_attempt_at=now()
 WHERE id=inv.id;
 RETURN pg_catalog.jsonb_build_object(
   'id',inv.id,'email',inv.invited_email,'role',inv.requested_role::text,
   'tenant_id',inv.tenant_id,'expires_at',inv.expires_at,
   'sender',cfg.sender_email
 );
END; $function$
;
CREATE OR REPLACE FUNCTION public.lkz_isp_internal_finalize_invite_delivery(p_invitation uuid, p_success boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE inv record;
BEGIN
 SELECT * INTO inv FROM public.lkz_isp_user_invitations WHERE id=p_invitation FOR UPDATE;
 IF NOT FOUND OR inv.status<>'sending' THEN
   RAISE EXCEPTION 'INVITE_NOT_IN_DELIVERY' USING ERRCODE='42501';
 END IF;
 UPDATE public.lkz_isp_user_invitations SET
  status=CASE WHEN p_success THEN 'sent' ELSE 'pending' END,
  sent_at=CASE WHEN p_success THEN now() ELSE sent_at END
 WHERE id=p_invitation;
 IF p_success THEN
   INSERT INTO public.lkz_isp_audit_events(tenant_id,actor_id,event_name,target_id,audit_visibility,details)
   VALUES(inv.tenant_id,inv.created_by,'invite.email_submitted',inv.id,
    CASE WHEN EXISTS(SELECT 1 FROM lkz_private.lkz_isp_system_masters s WHERE s.user_id=inv.created_by AND s.active)
      THEN 'master_only' ELSE 'standard' END,
    jsonb_build_object('role',inv.requested_role::text,'smtp_sender','convites@lacrosetecnologia.com.br'));
 END IF;
 RETURN CASE WHEN p_success THEN 'sent' ELSE 'pending' END;
END; $function$
;
COMMIT;
