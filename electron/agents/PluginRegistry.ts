// PluginRegistry.ts — Agent registration and discovery system

import { BaseAgent } from './BaseAgent';
import { QueryType } from './types';

/**
 * PluginRegistry manages the registration and discovery of agents.
 * 
 * To add a new agent capability:
 * 1. Create a class extending BaseAgent
 * 2. Call registry.register(new YourAgent(providerManager))
 * 3. The Orchestrator will automatically discover and route to it
 */
export class PluginRegistry {
  private agents: Map<string, BaseAgent> = new Map();

  /**
   * Register a new agent. Replaces any existing agent with the same ID.
   */
  register(agent: BaseAgent): void {
    if (this.agents.has(agent.id)) {
      console.warn(`[PluginRegistry] Replacing existing agent: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
    console.log(`[PluginRegistry] Registered agent: ${agent.id} (${agent.capability.name})`);
  }

  /**
   * Unregister an agent by its ID.
   */
  unregister(agentId: string): boolean {
    const existed = this.agents.delete(agentId);
    if (existed) {
      console.log(`[PluginRegistry] Unregistered agent: ${agentId}`);
    }
    return existed;
  }

  /**
   * Get a specific agent by ID.
   */
  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents that support a given query type, sorted by priority (highest first).
   */
  getAgentsForType(queryType: QueryType): BaseAgent[] {
    return Array.from(this.agents.values())
      .filter((agent) => agent.capability.supportedQueryTypes.includes(queryType))
      .sort((a, b) => b.capability.priority - a.capability.priority);
  }

  /**
   * Get all registered agents.
   */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get a summary of all registered agents for logging/debugging.
   */
  getSummary(): Array<{ id: string; name: string; types: QueryType[] }> {
    return Array.from(this.agents.values()).map((agent) => ({
      id: agent.id,
      name: agent.capability.name,
      types: agent.capability.supportedQueryTypes,
    }));
  }

  /**
   * Check if any agent is registered for a given query type.
   */
  hasAgentForType(queryType: QueryType): boolean {
    return this.getAgentsForType(queryType).length > 0;
  }

  /**
   * Returns the number of registered agents.
   */
  get size(): number {
    return this.agents.size;
  }
}
