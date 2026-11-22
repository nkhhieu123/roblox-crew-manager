import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { db } from "@/lib/server/supabase";
import { normalizeConfig } from "@/lib/server/requirements";
import { DEFAULT_REQUIREMENT } from "@/lib/engine/types";
import { RequirementEditor } from "./requirement-editor";

export default async function RequirementEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let initial = { id: null as string | null, name: "", description: "", config: DEFAULT_REQUIREMENT };
  if (id !== "new") {
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
    const { data } = await db().from("requirement_sets").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    initial = { id: data.id, name: data.name, description: data.description ?? "", config: normalizeConfig(data.config) };
  }
  return (
    <>
      <Link href="/requirements" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Requirements
      </Link>
      <PageHeader
        title={initial.id ? `Sửa: ${initial.name}` : "Bộ điều kiện mới"}
        description="Lưu sẽ tạo phiên bản mới. Kết quả đánh giá trước đây giữ nguyên phiên bản cũ."
      />
      <RequirementEditor initial={initial} />
    </>
  );
}
