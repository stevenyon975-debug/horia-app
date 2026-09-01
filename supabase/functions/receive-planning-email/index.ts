import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    console.log(`RESEND_API_KEY présente : ${!!Deno.env.get('RESEND_API_KEY')}`)
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const bodyText = await req.text()
    const bodyBytes = new TextEncoder().encode(bodyText).length
    console.log(`Payload reçu : ${bodyBytes} bytes / ${bodyText.length} caractères`)

    const payload = JSON.parse(bodyText)
    const data = payload?.data ?? {}

    const firstPdf = (data.attachments ?? []).find(
      (a: any) =>
        a?.content_type === 'application/pdf' &&
        a?.content_disposition === 'attachment'
    )
    if (firstPdf) {
      console.log(`Clés du premier attachment PDF : ${Object.keys(firstPdf).join(', ')}`)
      console.log(`Premier attachment PDF a un champ content : ${Object.prototype.hasOwnProperty.call(firstPdf, 'content')}`)
    }

    // Extraire l'adresse email de l'expéditeur
    const fromRaw: string = data.from ?? ''
    const fromMatch = fromRaw.match(/<([^>]+)>/) ?? fromRaw.match(/([^\s<>]+@[^\s<>]+)/)
    const fromEmail = (fromMatch?.[1] ?? fromRaw).toLowerCase().trim()

    if (!fromEmail) {
      return new Response(
        JSON.stringify({ error: 'No sender email' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Trouver l'utilisateur d'abord via professional_email, puis via email
    let profile: { id: string } | null = null
    let profileLookup = 'professional_email'

    const { data: proProfile, error: proProfileErr } = await supabase
      .from('profiles')
      .select('id')
      .ilike('professional_email', fromEmail)
      .maybeSingle()

    if (proProfileErr) throw proProfileErr
    profile = proProfile

    if (!profile) {
      const { data: emailProfile, error: emailProfileErr } = await supabase
        .from('profiles')
        .select('id')
        .ilike('email', fromEmail)
        .maybeSingle()

      if (emailProfileErr) throw emailProfileErr
      profile = emailProfile
      profileLookup = 'email'
    }

    if (!profile) {
      console.log(`Aucun profil HorIA pour l'email : ${fromEmail}`)
      return new Response(
        JSON.stringify({ error: 'User not found for sender email' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Profil trouvé via ${profileLookup} : ${fromEmail}`)

    const userId = profile.id
    const emailId: string | undefined = data.email_id

    // Filtrer les pièces jointes PDF réellement attachées
    const attachments: any[] = data.attachments ?? []
    console.log(`Nombre total d'attachments dans le payload : ${attachments.length}`)
    const pdfs = attachments.filter(
      (a: any) =>
        a?.content_type === 'application/pdf' &&
        a?.content_disposition === 'attachment'
    )
    console.log(`Nombre d'attachments PDF filtrés : ${pdfs.length}`)

    if (!pdfs.length) {
      return new Response(
        JSON.stringify({ error: 'No PDF attachments found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!emailId) {
      console.error('email_id manquant dans le payload')
      return new Response(
        JSON.stringify({ error: 'Missing email_id in payload' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    console.log(`email_id : ${emailId}`)

    const imported: { filename: string; planning_id: string }[] = []

    for (const attachment of pdfs) {
      try {
        // 1) Récupérer l'URL de téléchargement CDN via l'API Resend Inbound
        const metaUrl = `https://api.resend.com/emails/receiving/${emailId}/attachments/${attachment.id}`
        console.log(`Fetch Resend attachment metadata : ${metaUrl}`)
        const metaRes = await fetch(metaUrl, {
          headers: { Authorization: `Bearer ${resendApiKey}` },
        })
        console.log(
          `Réponse Resend (metadata) pour ${attachment.filename} : status ${metaRes.status}`
        )

        if (!metaRes.ok) {
          const errBody = await metaRes.text().catch(() => '')
          console.error(
            `Resend attachment metadata failed (${metaRes.status}) pour ${attachment.filename} — body: ${errBody}`
          )
          continue
        }

        const meta = (await metaRes.json().catch(() => null)) as { download_url?: string } | null
        const downloadUrl = meta?.download_url
        if (!downloadUrl) {
          console.error(`download_url manquant pour ${attachment.filename} — meta: ${JSON.stringify(meta)}`)
          continue
        }

        // 2) Télécharger le contenu binaire depuis le CDN (sans Authorization header)
        const binRes = await fetch(downloadUrl)
        console.log(`Réponse CDN pour ${attachment.filename} : status ${binRes.status}`)
        if (!binRes.ok) {
          console.error(`Téléchargement CDN échoué (${binRes.status}) pour ${attachment.filename}`)
          continue
        }

        const bytes = new Uint8Array(await binRes.arrayBuffer())
        console.log(`PDF ${attachment.filename} récupéré : ${bytes.length} bytes`)

        // Upload dans Supabase Storage
        const path = `${userId}/${crypto.randomUUID()}.pdf`
        const { error: uploadErr } = await supabase.storage
          .from('planning-pdfs')
          .upload(path, bytes, { contentType: 'application/pdf' })

        if (uploadErr) {
          console.error(`Upload échoué pour ${attachment.filename}:`, uploadErr)
          continue
        }

        // Créer l'entrée dans la table plannings
        const { data: planning, error: insertErr } = await supabase
          .from('plannings')
          .insert({
            user_id: userId,
            file_name: attachment.filename,
            file_path: path,
            size_bytes: bytes.length,
            mime_type: 'application/pdf',
            status: 'pending',
          })
          .select('id')
          .single()

        if (insertErr) {
          console.error(`Insert échoué pour ${attachment.filename}:`, insertErr)
          continue
        }

        imported.push({ filename: attachment.filename, planning_id: planning.id })
      } catch (err) {
        console.error(`Erreur traitement attachment ${attachment.filename}:`, err)
      }
    }

    return new Response(
      JSON.stringify({ success: true, imported: imported.length, plannings: imported }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('Erreur edge function:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
