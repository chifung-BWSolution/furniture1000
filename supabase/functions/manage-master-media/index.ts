import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MASTER_SUPABASE_URL = "https://kqwktnplkqucsbasyfjl.supabase.co";
const BUCKET_NAME = "product-images";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  try {
    const masterServiceKey = Deno.env.get("MASTER_SERVICE_ROLE_KEY");
    if (!masterServiceKey) {
      return new Response(
        JSON.stringify({
          error: "MASTER_SERVICE_ROLE_KEY not configured",
          hint: "Add the service role key for project kqwktnplkqucsbasyfjl in Edge Function Secrets",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const masterClient = createClient(MASTER_SUPABASE_URL, masterServiceKey, {
      auth: { persistSession: false },
    });

    // Parse multipart form data or JSON
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // JSON request: delete images or update image list
      const body = await req.json();
      const { action, master_id, file_paths, images } = body;

      if (!master_id) {
        return new Response(
          JSON.stringify({ error: "master_id is required" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }

      if (action === "delete") {
        // Delete files from storage
        if (!file_paths || !Array.isArray(file_paths) || file_paths.length === 0) {
          return new Response(
            JSON.stringify({ error: "file_paths array is required for delete action" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        console.log(
          `[manage-master-media] Deleting ${file_paths.length} files for master_id: ${master_id}`
        );

        const { error: deleteError } = await masterClient.storage
          .from(BUCKET_NAME)
          .remove(file_paths);

        if (deleteError) {
          console.error("[manage-master-media] Storage delete error:", deleteError.message);
          // Continue anyway — file might not exist
        }

        // Update the images JSONB column on bwf_product_master
        if (images !== undefined) {
          const { error: updateError } = await masterClient
            .from("bwf_product_master")
            .update({ images: images, image_url: images?.[0]?.src || null })
            .eq("id", master_id);

          if (updateError) {
            console.error("[manage-master-media] DB update error:", updateError.message);
            return new Response(
              JSON.stringify({ success: false, error: updateError.message }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 500,
              }
            );
          }
        }

        return new Response(
          JSON.stringify({ success: true, deleted: file_paths }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      if (action === "update_images") {
        // Just update the images array in the DB
        const { error: updateError } = await masterClient
          .from("bwf_product_master")
          .update({ images: images || [], image_url: images?.[0]?.src || null })
          .eq("id", master_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ success: false, error: updateError.message }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Multipart form data: upload images
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const masterId = formData.get("master_id") as string;

      if (!masterId) {
        return new Response(
          JSON.stringify({ error: "master_id is required in form data" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }

      const uploadedImages: { src: string; alt: string; path: string }[] = [];
      const files = formData.getAll("files");

      console.log(
        `[manage-master-media] Uploading ${files.length} files for master_id: ${masterId}`
      );

      for (const file of files) {
        if (!(file instanceof File)) continue;

        const ext = file.name.split(".").pop() || "jpg";
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const filePath = `${masterId}/${timestamp}-${randomStr}.${ext}`;

        const { error: uploadError } = await masterClient.storage
          .from(BUCKET_NAME)
          .upload(filePath, file, {
            contentType: file.type || "image/jpeg",
            upsert: false,
          });

        if (uploadError) {
          console.error(
            `[manage-master-media] Upload error for ${file.name}:`,
            uploadError.message
          );
          continue;
        }

        // Get public URL
        const { data: urlData } = masterClient.storage
          .from(BUCKET_NAME)
          .getPublicUrl(filePath);

        if (urlData?.publicUrl) {
          uploadedImages.push({
            src: urlData.publicUrl,
            alt: file.name.replace(/\.[^/.]+$/, ""),
            path: filePath,
          });
        }
      }

      if (uploadedImages.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "No files were uploaded successfully" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      // Get existing images from DB
      const { data: existing } = await masterClient
        .from("bwf_product_master")
        .select("images, image_url")
        .eq("id", masterId)
        .single();

      const existingImages = Array.isArray(existing?.images) ? existing.images : [];
      const allImages = [...existingImages, ...uploadedImages];

      // Update bwf_product_master with new images array
      const { error: updateError } = await masterClient
        .from("bwf_product_master")
        .update({
          images: allImages,
          image_url: allImages[0]?.src || existing?.image_url || null,
        })
        .eq("id", masterId);

      if (updateError) {
        console.error("[manage-master-media] DB update error:", updateError.message);
        return new Response(
          JSON.stringify({
            success: false,
            error: updateError.message,
            uploaded: uploadedImages,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      console.log(
        `[manage-master-media] Successfully uploaded ${uploadedImages.length} images for ${masterId}`
      );

      return new Response(
        JSON.stringify({
          success: true,
          uploaded: uploadedImages,
          total_images: allImages.length,
          all_images: allImages,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unsupported content type. Use multipart/form-data for uploads or application/json for delete/update." }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[manage-master-media] Fatal error:", errMsg);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
