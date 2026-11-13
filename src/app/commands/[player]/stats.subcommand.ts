import createSql from '@/lib/database/connect';
import {
	ApplicationCommandOptionType,
	EmbedBuilder,
	EmbedField,
	MessageFlags,
} from 'discord.js';

import type { ChatInputCommand, CommandData } from 'commandkit';
import type { Row, Sql } from 'postgres';

export const command: CommandData = {
	name: 'stats',
	description: 'A summary of your stats',
	options: [
		{
			name: 'archived',
			description: 'Whether to include archived',
			type: ApplicationCommandOptionType.Boolean,
		},
	],
};

export const chatInput: ChatInputCommand = async (ctx) => {
	await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const sql: Sql = createSql();

	const player: Row | undefined = (
		await sql`
		SELECT
			id,
			name,
			name_color,
			private_stats
		FROM players
		WHERE discord_id = ${ctx.interaction.user.id}
	`
	)[0];

	if (!player) {
		await ctx.interaction.editReply(
			'Unable to find player, please visit the [claim player](https://celesteskillrating.net/claim-player) page to claim a player. Or [login](https://celesteskillrating.net/login) to create a new player',
		);
		return;
	}

	await ctx.interaction.editReply(
		`Fetching stats for ${player.name}<a:CelesteLoad:1236474786155200593>`,
	);

	interface Side {
		name: string;
		clearsForRank: number;
		showTierNames: boolean;
		tiers: [
			{
				id: number;
				name: string;
				appendSideName: boolean;
				clearsForRank: number;
				mods: [
					{
						id: number;
						name: string;
						clears: number;
						notes: string;
						cleared: boolean;
					},
				];
			},
		];
	}

	const archived = ctx.interaction.options.getBoolean('archived');
	const playerSideStats = await sql<Side[]>`
		SELECT
			s.name,
			s.clears_for_rank,
			s.show_tier_names,
			json_agg(
				json_build_object(
					'id', t.id,
					'name', tp.name,
					'append_side_name', tp.append_side_name,
					'clears_for_rank', t.clears_for_rank,
					'mods', m.mods
				)
				ORDER BY tp.side_index
			) AS tiers
		FROM sides s
		JOIN tiers t
			ON t.side_id = s.id
		JOIN tier_presets tp
			ON tp.id = t.preset_id		
		CROSS JOIN LATERAL (
			SELECT
				json_agg(
					json_build_object(
						'id', m.id,
						'name', m.name,
						'clears', c.clears,
						'notes', m.notes,
						'cleared', pp.cleared
					)
					ORDER BY lower(m.name)
				) AS mods
			FROM mods m
			LEFT JOIN player_progress pp
				ON
					pp.mod_id = m.id
					AND pp.player_id = ${player.id}
			LEFT JOIN LATERAL (
				SELECT
					COUNT(pp.id) AS clears
				FROM player_progress pp
				WHERE
					pp.mod_id = m.id
					AND NOT pp.is_private
			) c ON true
			WHERE m.tier_id = t.id
		) m
		${!archived ? sql`WHERE s.archived = false` : sql``} 
		GROUP BY s.id, s.name, s.clears_for_rank, s.color, s.archived, s.quick_install, s.show_tier_names
	`;
	// WHERE s.name ~ '-Side'

	// const playerClears: Row | undefined = await sql`
	// 		SELECT
	// 			pp.id,
	// 			pp.mod_id,
	// 			pp.proof,
	// 			pp.is_local_proof,
	// 			pp.cleared_date,
	// 			pp.deaths,
	// 			pp.time_taken,
	// 			pp.is_fc,
	// 			pp.public_notes,
	// 			pp.is_private,
	// 			pp.submitted_at,
	// 			m.name,
	// 			tp.name AS tier_name,
	// 			tp.color AS tier_color,
	// 			tp.color_plus AS tier_color_plus,
	// 			tp.side_index,
	// 			s.id AS side_id,
	// 			s.name AS side_name
	// 		FROM player_progress pp
	// 		JOIN mods m
	// 			ON pp.mod_id = m.id
	// 		JOIN tiers t
	// 			ON t.id = m.tier_id
	// 		JOIN tier_presets tp
	// 			ON tp.id = t.preset_id
	// 		JOIN sides s
	// 			ON s.id = t.side_id
	// 			AND s.name ~ 'Side'
	// 		WHERE player_id = ${player.id}
	// 		ORDER BY s.id, tp.side_index
	// `;
	// .map((clear: Row) => ({
	// 	...clear,
	// 	proof:
	// 		clear.isLocalProof || clear.proof.split(' ').length > 1
	// 			? `/players/${player.id}/clears/${clear.modId}`
	// 			: clear.proof,
	// }))
	// .map((clear: Row) =>
	// 	player.privateStats
	// 		? {
	// 				...clear,
	// 				timeTaken: null,
	// 				deaths: null,
	// 				isFc: null,
	// 				publicNotes: null,
	// 			}
	// 		: clear,
	// )
	// .map((clear: Row) => ({
	// 	name: clear.name,
	// 	value: `${clear.sideName} ${clear.tierName}`,
	// 	inline: true,
	// }));

	// console.log(playerSideStats);
	// if (!playerClears) {
	if (!playerSideStats) {
		await ctx.interaction.editReply(
			`${player.name} doesn't have any clears, go to the (submissions)[https://celesteskillrating.net/submit] page to get started!`,
		);

		return;
	}

	let totalClears: number = 0;
	const fields: EmbedField[] = [];
	for (const side of playerSideStats) {
		let sideClearCount: number = 0;
		side.tiers.forEach(
			(tier) =>
				(sideClearCount += tier.mods.filter((mod) => mod.cleared).length),
		);
		totalClears += sideClearCount;

		fields.push({
			name: side.name,
			value: sideClearCount.toString(),
			inline: true,
		});
	}

	// let clearCount: number = 0;
	// playerSideStats
	// 	.flatMap((side) => side.tiers.flatMap((tier) => tier.mods.length))
	// 	.forEach((side) => {
	// 		clearCount += side;
	// 	}) ?? 0;

	// for (const side of playerSideStats) {
	// 	for (const tier of side.tiers) {
	// 		for (const mod of tier.mods) {
	// 			fields.push({
	// 				name: mod.name,
	// 				value: `${side.name} ${tier.name}`,
	// 				inline: true,
	// 			});
	// 		}
	// 	}
	// }

	// const maxModsPerPage: Number = 15;

	// const playerStatsEmbed: EmbedBuilder = new EmbedBuilder()
	// 	.setColor(player.nameColor ?? 'NotQuiteBlack')
	// 	.setThumbnail(
	// 		`https://cdn.discordapp.com/avatars/${ctx.interaction.user.id}/${ctx.interaction.member?.avatar ?? ctx.interaction.user.avatar}`,
	// 	)
	// 	.setTitle(`${player.name}'s Stats`)
	// 	.setDescription(`${playerClears.length ?? 0}`)
	// 	.setFields(playerClears.splice(0, maxModsPerPage))
	// 	.setTimestamp();

	const playerQuickStatsEmbed: EmbedBuilder = new EmbedBuilder()
		.setColor(player.nameColor ?? 'NotQuiteBlack')
		.setThumbnail(
			`https://cdn.discordapp.com/avatars/${ctx.interaction.user.id}/${ctx.interaction.member?.avatar ?? ctx.interaction.user.avatar}`,
		)
		.setTitle(`${player.name}'s Stats`)
		.setDescription(`${totalClears} clears`)
		.setFields(fields.splice(0, 25))
		.setTimestamp();

	ctx.interaction.editReply({
		content: '',
		embeds: [playerQuickStatsEmbed],
	});

	sql.end();
};
