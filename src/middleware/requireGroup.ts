import { Request, Response, NextFunction } from "express";

export function requireGroup(groupName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u: any = (req as any).user || {};
    const groups: string[] = u["cognito:groups"] || [];
    if (!groups.includes(groupName)) {
      return res
        .status(403)
        .json({ error: { code: "forbidden", message: `Requires group: ${groupName}` } });
    }
    next();
  };
}