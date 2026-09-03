CREATE OR REPLACE FUNCTION public.admin_publish_music_request(
  p_request_id bigint,
  p_src text,
  p_cover text DEFAULT NULL,
  p_genre text DEFAULT NULL,
  p_style text DEFAULT NULL,
  p_style_tags text[] DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_lrc text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request public.music_requests;
  v_music_id bigint;
BEGIN
  IF NOT public.is_fenda_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem publicar solicitações';
  END IF;
  IF nullif(btrim(coalesce(p_src, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Um áudio autorizado é obrigatório para publicar';
  END IF;
  SELECT * INTO v_request FROM public.music_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_request.status IN ('rejected', 'blocked', 'published') THEN
    RAISE EXCEPTION 'Esta solicitação não pode ser publicada no estado atual';
  END IF;
  INSERT INTO public.musics (
    title, artist, src, cover, lrc, genre, album, release_date,
    track_order, visibility, style, style_tags
  ) VALUES (
    v_request.title,
    v_request.artist,
    p_src,
    COALESCE(NULLIF(btrim(p_cover), ''), v_request.cover_url),
    COALESCE(NULLIF(btrim(p_lrc), ''), v_request.lyrics_url),
    COALESCE(NULLIF(btrim(p_genre), ''), v_request.genre),
    v_request.album,
    NULL,
    NULL,
    'public',
    NULLIF(btrim(p_style), ''),
    COALESCE(p_style_tags, ARRAY[]::text[])
  )
  RETURNING id INTO v_music_id;
  UPDATE public.music_requests
  SET status = 'published',
      audio_url = p_src,
      cover_url = COALESCE(NULLIF(btrim(p_cover), ''), cover_url),
      genre = COALESCE(NULLIF(btrim(p_genre), ''), genre),
      lyrics_url = COALESCE(NULLIF(btrim(p_lrc), ''), lyrics_url),
      admin_notes = COALESCE(p_notes, admin_notes),
      published_music_id = v_music_id,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;
  RETURN v_music_id;
END;
$$;
