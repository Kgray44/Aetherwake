"use strict";
/** Shared existing mission review/start path; no model routing or new scheduler. */
async function startReviewedMission({win,event,localURL,storage,call,dialog,input,beforeStart}) {
  const guard=()=>{
    if(!win||win.isDestroyed()||win.webContents.isDestroyed()||!win.isVisible()||win.isMinimized()||!win.isFocused()||
      event?.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||
      event.senderFrame?.url!==localURL||win.webContents.getURL()!==localURL)throw Error('unauthorized_sender');
  };
  const checkedDialog={};
  for(const name of ['showMessageBox','showOpenDialog'])checkedDialog[name]=async(...args)=>{guard();const result=await dialog[name](...args);guard();return result;};
  guard();let result;
            if (Object.hasOwn(input.input ?? {}, "approvedArtifactDigest")) throw Error("mission_native_review_required");
            const preview = await call("missions", { name: "preview", input: {
            objective: input.input?.objective, ...(input.input?.agentProfileId ? { agentProfileId: input.input.agentProfileId } : {}),
            ...(input.input?.proposalId ? { proposalId: input.input.proposalId } : {}),
            ...(input.input?.teamId ? { teamId: input.input.teamId } : {}),
          } });
          if (!preview?.plan || preview.fingerprint !== input.input?.fingerprint) throw Error("mission_preview_changed");
            let approvedProjectCheck, approvedArtifactDigest;
            if (preview.artifactReview) {
              if (preview.executors.some(executor => !executor.available)) throw Error("mission_artifact_unavailable");
              const { prompt, digest, model, width, height, files } = preview.artifactReview;
              const choice = await checkedDialog.showMessageBox(win, {
                type: "question", buttons: ["Cancel", "Generate and save"], defaultId: 0, cancelId: 0,
                title: "Review illustration mission", message: `Send this prompt to ${model} through the dedicated Vela API?`,
                detail: `Prompt sent to OpenAI:\n${prompt}\n\nSave a ${width} × ${height} PNG and text notes to this workspace's managed files:\n${files.join("\n")}\n\nThis uses one image generation request on your configured API account.`,
              });
              if (choice.response !== 1) throw Error("mission_review_declined");
              approvedArtifactDigest = digest;
            }
          if (preview.externalReview) {
            if (preview.executors.some(executor => !executor.available)) throw Error("mission_specialist_unavailable");
            const { provider, calls } = preview.externalReview;
            const assignments = preview.plan.tasks.filter(task => task.specialist).map(({ id, objective, criterion, dependencies, specialist }) =>
              `${id}: ${specialist.role} — ${specialist.provider} · ${specialist.model}${specialist.effort ? " · " + specialist.effort : ""}${specialist.webSearch ? " · public web search" : ""}\nTask: ${objective}\nCriterion: ${criterion}\nVerified prerequisite receipts: ${dependencies.join(', ') || 'none'}\n${specialist.instructions}`);
            const apiWorkers = preview.plan.tasks.some(task => task.specialist?.provider === 'openai-api-vela');
            const choice = await checkedDialog.showMessageBox(win, {
              type: "question", buttons: ["Cancel", preview.localReview ? "Approve specialists" : "Start mission"], defaultId: 0, cancelId: 0,
              title: "Review specialist mission", message: `Send ${calls} separate requests to ${provider}?`,
              detail: `Objective sent to each specialist:\n${preview.plan.objective}\n\nInstructions and reviewed inputs:\n${assignments.join("\n\n")}\n\n${apiWorkers ? `API workers receive this objective, task objectives, mission criteria (${preview.plan.criteria.join(', ')}), project/workspace scope identifiers and whole verified receipts from only their named prerequisites. Those future receipt bodies are compiled when prerequisites finish. Each exact request body and context digest is bound to one use and revalidated before dispatch. API workers have no web search, file, notes or chat-history tools. API calls use the dedicated key and authorized usage limits.` : 'The provider may count these requests against your plan. No files, chat history or local measurements are sent.'}`,
            });
            if (choice.response !== 1) throw Error("mission_review_declined");
          }
          if (preview.localReview) {
            if (preview.executors.some(executor => !executor.available)) throw Error("mission_project_check_unavailable");
            const selected = await checkedDialog.showOpenDialog(win, {
              title: "Choose tracked Node test files in one Git checkout",
              properties: ["openFile", "multiSelections"],
              filters: [{ name: "Node test sources", extensions: ["js", "cjs", "mjs", "ts", "mts"] }],
            });
            if (selected.canceled || !selected.filePaths.length) throw Error("mission_review_declined");
            const paths = selected.filePaths;
            if (paths.length > preview.localReview.maxFiles) throw Error("mission_project_check_selection_limit");
            const review = await call("missionCheckReview", { paths });
            const choice = await checkedDialog.showMessageBox(win, {
              type: "question", buttons: ["Cancel", "Run reviewed mission"], defaultId: 0, cancelId: 0,
              title: "Review read-only project tests", message: "Run the selected Node tests alongside native measurements?",
              detail: `Checkout: ${review.cwd}\nCommit: ${review.head}\nArguments: ${JSON.stringify(review.argv)}\n\nCodex runs the selected command in a read-only sandbox with zero model requests. The sandbox requests restricted networking. Effective isolation depends on the installed Windows sandbox mode.`,
            });
            if (choice.response !== 1) throw Error("mission_review_declined");
            approvedProjectCheck = { paths, digest: review.digest };
          }
          guard();
          if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
          guard();
          await beforeStart?.({preview,input:input.input});
          guard();
          if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
          guard();
            if (preview.externalReview || approvedProjectCheck || approvedArtifactDigest) {
            if (win.isDestroyed() || event.senderFrame !== win.webContents.mainFrame || event.senderFrame?.url !== localURL)
              throw Error("unauthorized_sender");
            if (!(await storage.allowWrite())) throw Error("storage_reserve_admission_denied");
            guard();
              result = await call("missionStartReviewed", { ...input.input, ...(approvedProjectCheck ? { approvedProjectCheck } : {}),
                ...(approvedArtifactDigest ? { approvedArtifactDigest } : {}) });
          } else result = await call("missions", input);

  return result;
}
module.exports={startReviewedMission};
