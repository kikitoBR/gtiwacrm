import { describe, it, expect } from "vitest"
import {
  mapAtPath,
  insertAt,
  removeAt,
  moveAt,
  type BuilderStep,
  type StepPath,
} from "./automation-builder"

describe("automation-builder tree mutations", () => {
  it("updates a step text inside a condition's yes branch via mapAtPath", () => {
    const conditionStep: BuilderStep = {
      cid: "cond-1",
      step_type: "condition",
      step_config: { subject: "time_of_day" },
      branches: {
        yes: [
          {
            cid: "send-1",
            step_type: "send_message",
            step_config: { text: "" },
          },
        ],
        no: [],
      },
    }

    const steps: BuilderStep[] = [conditionStep]

    // Path computed by the builder for send-1 inside yes branch:
    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "cond-1", branch: "yes", index: 0 },
    ]

    const updated = mapAtPath(steps, path, (s) => ({
      ...s,
      step_config: { ...s.step_config, text: "Olá! Seja bem vindo!" },
    }))

    const yesChild = updated[0].branches?.yes[0]
    expect(yesChild?.step_config.text).toBe("Olá! Seja bem vindo!")
  })

  it("updates a step text inside a condition's no branch via mapAtPath", () => {
    const conditionStep: BuilderStep = {
      cid: "cond-1",
      step_type: "condition",
      step_config: { subject: "time_of_day" },
      branches: {
        yes: [],
        no: [
          {
            cid: "send-no",
            step_type: "send_message",
            step_config: { text: "" },
          },
        ],
      },
    }

    const steps: BuilderStep[] = [conditionStep]

    const path: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "cond-1", branch: "no", index: 0 },
    ]

    const updated = mapAtPath(steps, path, (s) => ({
      ...s,
      step_config: { ...s.step_config, text: "Atendimento fora do horário" },
    }))

    const noChild = updated[0].branches?.no[0]
    expect(noChild?.step_config.text).toBe("Atendimento fora do horário")
  })

  it("inserts, moves, and deletes steps inside a condition branch", () => {
    let steps: BuilderStep[] = [
      {
        cid: "cond-1",
        step_type: "condition",
        step_config: { subject: "time_of_day" },
        branches: {
          yes: [],
          no: [],
        },
      },
    ]

    // Insert into yes branch
    steps = insertAt(
      steps,
      { kind: "branch", parentCid: "cond-1", branch: "yes" },
      0,
      {
        cid: "msg-1",
        step_type: "send_message",
        step_config: { text: "Mensagem 1" },
      },
    )

    steps = insertAt(
      steps,
      { kind: "branch", parentCid: "cond-1", branch: "yes" },
      1,
      {
        cid: "msg-2",
        step_type: "send_message",
        step_config: { text: "Mensagem 2" },
      },
    )

    expect(steps[0].branches?.yes).toHaveLength(2)

    // Move msg-2 up
    const pathMsg2: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "cond-1", branch: "yes", index: 1 },
    ]
    steps = moveAt(steps, pathMsg2, -1)
    expect(steps[0].branches?.yes[0].cid).toBe("msg-2")
    expect(steps[0].branches?.yes[1].cid).toBe("msg-1")

    // Delete msg-1 (now at index 1)
    const pathMsg1: StepPath = [
      { kind: "root", index: 0 },
      { kind: "branch", parentCid: "cond-1", branch: "yes", index: 1 },
    ]
    steps = removeAt(steps, pathMsg1)
    expect(steps[0].branches?.yes).toHaveLength(1)
    expect(steps[0].branches?.yes[0].cid).toBe("msg-2")
  })
})
