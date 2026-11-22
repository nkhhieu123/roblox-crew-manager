"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitMerge, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/app/confirm-button";
import { deleteMember, mergeMember, saveNotes, setExempt, setLeft } from "../actions";

export function MemberProfileActions({
  memberId,
  username,
  exempt,
  exemptReason,
  notes,
  leftAt,
}: {
  memberId: string;
  username: string;
  exempt: boolean;
  exemptReason: string | null;
  notes: string | null;
  leftAt: string | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState(exemptReason ?? "");
  const [text, setText] = useState(notes ?? "");
  const [mergeTarget, setMergeTarget] = useState("");
  const [pending, start] = useTransition();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Miễn điều kiện</CardTitle>
          <CardDescription>Thành viên được miễn sẽ có trạng thái EXEMPT ở mọi bộ điều kiện.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Lý do (VD: nghỉ phép, admin…)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={exempt}
              disabled={pending}
              onCheckedChange={(v) =>
                start(async () => {
                  const r = await setExempt(memberId, v, reason.trim() || null);
                  if (r.ok) toast.success(v ? "Đã đánh dấu miễn điều kiện. Bấm “Đánh giá lại” để cập nhật kết quả." : "Đã bỏ miễn điều kiện");
                  else toast.error(r.error);
                })
              }
            />
            {exempt ? "Đang được miễn" : "Không miễn"}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trong crew</CardTitle>
          <CardDescription>
            Thường được tự cập nhật khi upload đủ danh sách. Người đã rời vẫn giữ lịch sử, không bị đánh giá tiếp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmButton
            variant={leftAt ? "default" : "outline"}
            title={leftAt ? `Đưa ${username} trở lại crew?` : `Đánh dấu ${username} đã rời crew?`}
            description={
              leftAt
                ? "Thành viên sẽ xuất hiện lại trong danh sách và được đánh giá từ lần upload tiếp theo."
                : "Thành viên sẽ ẩn khỏi danh sách chính và không bị đánh giá tiếp. Lịch sử vẫn được giữ."
            }
            confirmLabel={leftAt ? "Đưa trở lại" : "Đánh dấu đã rời"}
            onConfirm={async () => {
              const r = await setLeft(memberId, !leftAt);
              if (r.ok) toast.success(leftAt ? "Đã đưa trở lại crew" : "Đã đánh dấu rời crew");
              else toast.error(r.error);
            }}
          >
            {leftAt ? "Đưa trở lại crew" : "Đánh dấu đã rời crew"}
          </ConfirmButton>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ghi chú nội bộ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Chỉ 2 quản lý nhìn thấy" />
          <Button
            size="sm"
            disabled={pending || text === (notes ?? "")}
            onClick={() =>
              start(async () => {
                const r = await saveNotes(memberId, text);
                if (r.ok) toast.success("Đã lưu ghi chú");
                else toast.error(r.error);
              })
            }
          >
            Lưu ghi chú
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sửa lỗi nhận diện</CardTitle>
          <CardDescription>Nếu hồ sơ này được tạo do OCR đọc sai Username, gộp toàn bộ lịch sử vào đúng thành viên.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Gộp vào Username</Label>
            <Input value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} placeholder="Username đúng" />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              variant="outline"
              disabled={!mergeTarget.trim()}
              title={`Gộp ${username} vào ${mergeTarget}?`}
              description="Toàn bộ dữ liệu snapshot của hồ sơ này sẽ chuyển sang thành viên đích, sau đó hồ sơ này bị xóa. Hãy đánh giá lại sau khi gộp."
              confirmLabel="Gộp"
              onConfirm={async () => {
                const r = await mergeMember(memberId, mergeTarget.trim());
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Đã gộp vào ${r.username}`);
                router.push(`/members/${encodeURIComponent(r.username)}`);
              }}
            >
              <GitMerge /> Gộp
            </ConfirmButton>
            <ConfirmButton
              title={`Xóa thành viên ${username}?`}
              description="Hồ sơ cùng toàn bộ dữ liệu snapshot và kết quả đánh giá của người này sẽ bị xóa vĩnh viễn. Không thể hoàn tác."
              confirmLabel="Xóa vĩnh viễn"
              onConfirm={async () => {
                const r = await deleteMember(memberId);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Đã xóa thành viên");
                router.push("/members");
              }}
            >
              <Trash2 /> Xóa
            </ConfirmButton>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
