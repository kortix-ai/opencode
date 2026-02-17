import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with OpenCode.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
        return c.json(projects)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create project",
        description:
          "Create or register a project from a directory path. If the project already exists, returns the existing project.",
        operationId: "project.create",
        responses: {
          200: {
            description: "Created or existing project",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Project.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const project = await Project.create(body)
        return c.json(project)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that OpenCode is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .get(
      "/:projectID",
      describeRoute({
        summary: "Get project",
        description: "Retrieve a specific project by its ID.",
        operationId: "project.get",
        responses: {
          200: {
            description: "Project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const project = await Project.get(projectID)
        return c.json(project)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    )
    .delete(
      "/:projectID",
      describeRoute({
        summary: "Delete project",
        description: "Delete a project and cascade-remove all its sessions, messages, and parts.",
        operationId: "project.delete",
        responses: {
          200: {
            description: "Successfully deleted project",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        await Project.remove(projectID)
        return c.json(true)
      },
    ),
)
